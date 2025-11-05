const { Telegraf, Markup } = require('telegraf');
const {
    str2params,
    date2int,
    date2text,
    parseDate,
    getStatusByAction,
    textMarkdownNormalize,
    extractUserTitle,
    occurrences,
    isTrue,
    extractStartTime,
    normalizeParsedDate
} = require('../helpers/utils');

class Bot {
    constructor(config, database, webServer) {
        this.config = config;
        this.database = database;
        this.webServer = webServer;
        this.bot = new Telegraf(this.config.botToken);
        this.botName = null;
        this.botUrl = null;
        this.botCommands = require('../config/commands-descriptions.json');
        this.emoji = require('../config/emoji.json');
        this.package = require('../package.json');

        this.setupCommands();
        this.setupActions();
        this.setupMyChatMember();
    }

    setupCommands() {
        this.bot.command('start', this.handleStart.bind(this));
        this.bot.command('help', this.handleHelp.bind(this));
        this.bot.command('add_game', this.handleAddGame.bind(this));
        this.bot.command('del_game', this.handleDelGame.bind(this));
        this.bot.command('change_game', this.handleChangeGame.bind(this));
        this.bot.command('kick', this.handleKickFromGame.bind(this));
        this.bot.command('active_games', this.handleActiveGames.bind(this));
        this.bot.command('__ver', this.handleGetVersion.bind(this));
        this.bot.command('__time', this.handleTime.bind(this));
        this.bot.command('__send_to', this.handleSendTo.bind(this));
        this.bot.command('__adm', this.handleGetAdm.bind(this));
        this.bot.command('__del_msg', this.handleDeleteMessage.bind(this));
    }

    setupActions() {
        this.bot.action(/^join_(.*)$/, (ctx) => this.updateGameStatus(ctx, 'join'));
        this.bot.action(/^pending_(.*)$/, (ctx) => this.updateGameStatus(ctx, 'pending'));
        this.bot.action(/^decline_(.*)$/, (ctx) => this.updateGameStatus(ctx, 'decline'));
    }

    setupMyChatMember() {
        this.bot.on('my_chat_member', (ctx) => {
            const newStatus = ctx.update.my_chat_member.new_chat_member.status;
            const chatId = ctx.update.my_chat_member.chat.id;

            if (newStatus === 'kicked' || newStatus === 'left') {
                console.log(`Бот вилучений з чату ${chatId}`);
                this.database.updateChatSettings({ chatId, botStatus: newStatus });
            } else if (newStatus === 'member') {
                console.log(`Бот доданий до чату ${chatId}`);
                this.database.updateChatSettings({ chatId, botStatus: newStatus }, async () => await this.makeChatSettings(chatId, ctx));
                this.replyOrDoNothing(ctx, 'Привіт! Дякую за додавання мене до групи.');
            }
        });
    }

    async handleStart(ctx) {
        const user = ctx.from;
        await this.database.updateUser({...user, started: true, startedTimestamp: new Date()});
        let message = this.botCommands['start']?.description;
        if (!message) return;
        let tpl = eval('`'+message+'`');
        if (ctx.chat.id < 0)
            this.bot.telegram.sendMessage(user.id, tpl, { parse_mode: 'Markdown' });
        else
            this.replyOrDoNothing(ctx, tpl);
    }

    async handleHelp(ctx) {
        // TODO: need to check "licensed" property
        this.replyOrDoNothing(ctx, '👾 Список команд, що підтримуються:\n' +
            Object.keys(this.botCommands)
                .filter(key => this.botCommands[key].isDisplayable !== false)
                .map(key => {
                    let cmd = this.botCommands[key];
                    return `    /${key} - ${cmd.description} ${cmd.example || ''}`;
                }).join('\n') + this.botCommands['help'].extra || ''
        );
    }

    async handleGetVersion(ctx) {
        this.replyToUserDirectOrDoNothing(ctx, this.package.version);
    }

    async handleTime(ctx) {
        const chatId = ctx.chat.id;
        const now = new Date();
        let replyText = `Час на сервері:\n${now}\n${now.toISOString()}\n${now.toLocaleString()}\nЧасовий здвиг на сервері:\n${now.getTimezoneOffset()} хв.`;
        const chatSettings = await this.database.getChatSettings(chatId);
        if (chatSettings) {
            let parsedDate = normalizeParsedDate(now.getTime(), chatSettings.timezone || chatSettings.timezoneOffset);
            const clientNow = new Date(parsedDate);
            replyText += `\n\nЧас у вас:\n${clientNow}\nЧасова зона/здвиг у вас:\n${chatSettings.timezone || chatSettings.timezoneOffset}\n`;
        }
        this.replyToUserDirectOrDoNothing(ctx, replyText);
    }

    async handleSendTo(ctx) {
        if (!await this.isSuperAdmin(ctx.from.id)) return;
        let [_, ...args] = str2params(ctx.message.text);
        this.replyToUserDirectOrDoNothing({ from: { id: parseInt(args[0]) } }, textMarkdownNormalize(args[1]));
    }

    async handleGetAdm(ctx) {
        this.replyToUserDirectOrDoNothing(ctx, String((await this.database.getGlobalSettings())?.superAdminId));
    }

    async handleDeleteMessage(ctx) {
        if (!await this.isSuperAdmin(ctx.from.id)) return;
        let [_, chatId, messageId] = str2params(ctx.message.text);

        try {
            await this.bot.telegram.deleteMessage(chatId, messageId);
        } catch (error) {
            return this.replyToUserDirectOrDoNothing(ctx, error);
        }
        return this.replyToUserDirectOrDoNothing(ctx, 'Повідомлення видалено.');
    }

    async handleAddGame(ctx) {
        const chatId = ctx.chat.id;
        if (!(chatId < 0)) {
            return this.replyToUserDirectOrDoNothing(ctx, this.emoji.err + 'Ця команда доступна тільки для груп!');
        }
        let [cmdName, ...args] = str2params(ctx.message.text);
        cmdName = cmdName.slice(1);

        let chatSettings = await this.database.getChatSettings(chatId);
        if (!await this.isSuperAdmin(ctx.from.id)) {
            if (!chatSettings) {
                chatSettings = await this.makeChatSettings(chatId, ctx);
                await this.database.createChatSettings(chatSettings);
            }

            if (!(await this.hasSuitedLicense(chatSettings, cmdName)))
                return this.replyToUserDirectOrDoNothing(ctx, this.emoji.noaccess + 'Недостатня ліцензія на використання цієї команди.');
            if (!this.hasPermission(chatSettings, cmdName, ctx.from.id))
                return this.replyToUserDirectOrDoNothing(ctx, this.emoji.noaccess + 'У вас немає повноважень на використання цієї команди.');
        }

        if (args.length < 3) return this.replyOrDoNothing(ctx, this.emoji.warn + 'Передана недостатня кількість параметрів. ' + this.botCommands[cmdName].example);
        if (args.length > 3) return this.replyOrDoNothing(ctx, this.emoji.warn + 'Передана некоректа кількість параметрів. ' + (occurrences(ctx.message.text, '"') > 2 ? 'Скоріше проблема з використанням подвійних лапок ("). ' : '') + this.botCommands[cmdName].example);

        const name = args[0];
        let stringDate = args[1];
        if (stringDate.match(/\d+/g).length === 3) {
            const time = extractStartTime(name);
            if (time) stringDate += ' ' + time;
        }
        const parsedDate = parseDate(stringDate, chatSettings.timezone || chatSettings.timezoneOffset);
        if (!parsedDate) return this.replyOrDoNothing(ctx, this.emoji.warn + 'Дату треба вказувати у такому форматі: 2025-03-25 або "2025-03-25 11:00"');

        let maxPlayers = parseInt(args[2]);
        if (!maxPlayers || maxPlayers <= 0) return this.replyOrDoNothing(ctx, 'Кількість ігроків повинно бути числом більше 0.');

        const creatorId = ctx.from.id;
        const creatorName = extractUserTitle(ctx.from, false);

        const game = {
            createdDate: new Date(),
            createdById: creatorId,
            createdByName: creatorName,
            isActive: true,
            chatId,
            name,
            date: new Date(parsedDate),
            isDateWithoutTime: stringDate.match(/\d+/g).length < 4,
            maxPlayers: parseInt(args[2]),
            players: []
        };

        const gameId = await this.database.createGame(game);
        const message = await this.writeGameMessage(ctx, game, gameId);
        await this.database.updateGame(gameId, { messageId: message.message_id });

        const replyText = `Ви щойно створили гру "${game.name}" (id=${gameId}).` + (game.isDateWithoutTime ? '\n\n' + this.emoji.warn + 'Для того щоб коректно нагадувати та деактивовувати ігри краще зазначати дату ігри разом з часом.' : '');
        this.replyToUserDirectOrDoNothing(ctx, replyText);
    }

    async handleDelGame(ctx) {
        // Важливо: ця команда може запускатись не з групи а напряму боту, тому айді чата береться з гри
        let [cmdName, ...args] = str2params(ctx.message.text);
        cmdName = cmdName.slice(1);

        if (args.length < 1) return this.replyOrDoNothing(ctx, this.emoji.warn + 'Не переданий ідентифікатор гри. ' + this.botCommands[cmdName].example);

        const gameId = args[0];
        const game = await this.database.getGame(gameId);
        if (!game) return;

        const chatId = game.chatId;
        if (!await this.isSuperAdmin(ctx.from.id)) {
            let chatSettings = await this.database.getChatSettings(chatId);
            if (!chatSettings && ctx.chat.id < 0) {
                chatSettings = await this.makeChatSettings(chatId, ctx);
                await this.database.createChatSettings(chatSettings);
            }
            if (!(await this.hasSuitedLicense(chatSettings, cmdName)))
                return this.replyToUserDirectOrDoNothing(ctx, this.emoji.noaccess + 'Недостатня ліцензія на використання цієї команди.');
            if (!this.hasPermission(chatSettings || { permissions: [] }, cmdName, ctx.from.id, game.createdById))
                return this.replyToUserDirectOrDoNothing(ctx, this.emoji.noaccess + 'У вас немає повноважень на використання цієї команди.');
        }

        if (!game.isActive) await this.database.deactivateGame(gameId);
        try {
            await this.bot.telegram.deleteMessage(game.chatId, game.messageId);
        } catch (error) {
            console.error(error);
            //await this.replyToUser(ctx, `Сталася помилка при спробі видалення повідомлення з грою: ${error?.code} - ${error?.description}`);
            try {
                game.isActive = false;
                await this.updateGameMessage(game, gameId);
            } catch (error) {}
        }
        const replyText = `Ви щойно видалили гру "${game.name}" (id=${gameId}).`
        this.replyToUserDirectOrDoNothing(ctx, replyText);
    }

    async handleChangeGame(ctx) {
        // Важливо: ця команда може запускатись не з групи а напряму боту, тому айді чата береться з гри
        let [cmdName, ...args] = str2params(ctx.message.text);
        cmdName = cmdName.slice(1);

        if (args.length < 2) return this.replyOrDoNothing(ctx, this.emoji.warn + 'Передана недостатня кількість параметрів. ' + this.botCommands[cmdName].example);

        const gameId = args.shift();
        const game = await this.database.getGame(gameId);
        if (!game) return;

        const chatId = game.chatId;
        let chatSettings = await this.database.getChatSettings(chatId);
        if (!await this.isSuperAdmin(ctx.from.id)) {
            if (!chatSettings && ctx.chat.id < 0) {
                chatSettings = await this.makeChatSettings(chatId, ctx);
                await this.database.createChatSettings(chatSettings);
            }
            if (!(await this.hasSuitedLicense(chatSettings, cmdName)))
                return this.replyToUserDirectOrDoNothing(ctx, this.emoji.noaccess + 'Недостатня ліцензія на використання цієї команди.');
            if (!this.hasPermission(chatSettings || { permissions: [] }, cmdName, ctx.from.id, game.createdById))
                return this.replyToUserDirectOrDoNothing(ctx, this.emoji.noaccess + 'У вас немає повноважень на використання цієї команди.');
        }

        const supportedParams = { name: null, players: null, date: null, active: null };
        for (let i = 0; i < args.length; i++) {
            let [arg, ...val] = args[i].split('=');
            if (arg in supportedParams) {
                val = val.join('=');
                if (val === '') {
                    return this.replyToUserDirectOrDoNothing(ctx, this.emoji.warn + 'Не задане значення для параметру "' + arg + '"!');
                }
                supportedParams[arg] = val;
            } else {
                return this.replyToUserDirectOrDoNothing(ctx, this.emoji.warn + 'Параметр "' + arg + '" не підтримується!');
            }
        }

        const updateData = {};
        for (let key in supportedParams) {
            if (supportedParams[key] === null) {
                continue;
            }
            if (key === 'name') {
                updateData.name = supportedParams[key];
                game.name = updateData.name;
            } else if (key === 'players') {
                updateData.maxPlayers = parseInt(supportedParams[key]);
                if (!updateData.maxPlayers || updateData.maxPlayers <= 0) return this.replyToUserDirectOrDoNothing(ctx, this.emoji.warn + 'Кількість ігроків повинно бути числом більше 0.');
                game.maxPlayers = updateData.maxPlayers;
            } else if (key === 'date') {
                const stringDate = supportedParams[key];
                const parsedDate = parseDate(stringDate, chatSettings.timezone || chatSettings.timezoneOffset);
                if (!parsedDate) return this.replyToUserDirectOrDoNothing(ctx, this.emoji.warn + 'Дату треба вказувати у такому форматі: 2025-03-25 або "2025-03-25 11:00"');
                updateData.date = new Date(parsedDate);
                game.date = updateData.date;
                game.isDateWithoutTime = stringDate.match(/\d+/g).length < 4;
            } else if (key === 'active') {
                updateData.isActive = isTrue(supportedParams[key]);
                game.isActive = updateData.isActive;
            }
        }
        await this.database.updateGame(gameId, updateData);
        await this.updateGameMessage(game, gameId);

        const replyText = `Ви щойно змінили гру "${game.name}" (id=${gameId}).`
        this.replyToUserDirectOrDoNothing(ctx, replyText);
    }

    async handleKickFromGame(ctx) {
        // Важливо: ця команда може запускатись не з групи а напряму боту, тому айді чата береться з гри
        let [cmdName, ...args] = str2params(ctx.message.text);
        cmdName = cmdName.slice(1);

        if (args.length < 2) return this.replyOrDoNothing(ctx, this.emoji.warn + 'Передана недостатня кількість параметрів. ' + this.botCommands[cmdName].example);

        const gameId = args.shift();
        const game = await this.database.getGame(gameId);
        if (!game) return;

        const chatId = game.chatId;
        if (!await this.isSuperAdmin(ctx.from.id)) {
            let chatSettings = await this.database.getChatSettings(chatId);
            if (!chatSettings && ctx.chat.id < 0) {
                chatSettings = await this.makeChatSettings(chatId, ctx);
                await this.database.createChatSettings(chatSettings);
            }
            if (!(await this.hasSuitedLicense(chatSettings, cmdName)))
                return this.replyToUserDirectOrDoNothing(ctx, this.emoji.noaccess + 'Недостатня ліцензія на використання цієї команди.');
            if (!this.hasPermission(chatSettings || { permissions: [] }, cmdName, ctx.from.id, game.createdById, false))
                return this.replyToUserDirectOrDoNothing(ctx, this.emoji.noaccess + 'У вас немає повноважень на використання цієї команди.');
        }

        let player = args.shift();
        const filtered = game.players.filter(p => String(p.id) === player || p.name === player);
        if (filtered.length === 0) return this.replyToUserDirectOrDoNothing(ctx, this.emoji.warn + `Ігрока "${player}" не було знайдено у грі "${game.name}".`);
        if (filtered[0].status === 'kicked') return this.replyToUserDirectOrDoNothing(ctx, this.emoji.warn + `Ігрок "${player}" вже був виключений з гри "${game.name}".`);
        const setIds = new Set();
        filtered.forEach(p => setIds.add(p.id));
        if (setIds.size > 1) return this.replyToUserDirectOrDoNothing(ctx, this.emoji.warn + `Знайдено різних ігроків за запитом "${player}" у грі "${game.name}". Уточніть дані ігрока.`);
        filtered.forEach((p) => p.status = 'kicked');
        await this.database.updateGame(game._id, { players: game.players });

        this.updateGameMessage(game, gameId);
        return this.replyToUserDirectOrDoNothing(ctx, `Ігрока "${player}" виключено з гри "${game.name}".`);
    }

    async handleActiveGames(ctx) {
        const chatId = ctx.chat.id;
        const userId = ctx.from.id;
        const filter = { isActive: true };
        let where = '';
        if (chatId < 0) {
            filter.chatId = chatId;
            where = ' у ' + ctx.chat.title;
        }

        const games = await this.database.getActiveGames(filter);
        let response = `Немає активних ігор${where}.`;
        if (games.length) {
            const lines = [];
            games.forEach(game => {
                let gameDate = date2int(game.date);
                if (gameDate && gameDate + 86400000 < Date.now()) return;
                let status = (chatId < 0) ? ' Ще не має статусу' : '';
                let ind = game.players.filter(p => p.status === 'joined').sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).findIndex(p => p.id === userId);
                if (ind >= 0 && ind < game.maxPlayers) status = '✅ Йду';
                if (ind >= 0 && ind >= game.maxPlayers) status = '⏳ У черзі';
                if (game.players.some(p => p.id === userId && p.status === 'pending')) status = '❓ Думаю';
                if (game.players.some(p => p.id === userId && p.status === 'declined')) status = '❌ Не йду';
                if (game.players.some(p => p.id === userId && p.status === 'kicked')) status = "🦶 Вас виключено";
                if (status)
                    lines.push({gameDate, text: `📅 **${game.name} (${date2text(game.date)})** - ${status}`});
            });
            if (lines.length) {
                lines.sort((a, b) => (a.gameDate || 0) - (b.gameDate || 0));
                response = `📋 **Активні ігри${where}:**\n\n` + lines.map(elem => elem.text).join(`\n`);
            }
        }
        this.replyToUser(ctx, response);
    }

    async updateGameStatus(ctx, action) {
        const [gameId, extraAction] = ctx.match[1].split('_');
        const userId = ctx.from.id;
        const username = extractUserTitle(ctx.from);
        const timestamp = new Date();

        const game = await this.database.getGame(gameId);
        if (!game || !game.isActive) return;

        const newStatus = getStatusByAction(action);
        let playerInd = game.players.findIndex(p => p.id === userId && !p.extraPlayer);
        if (playerInd != -1 && game.players[playerInd].status === 'kicked') {
            return this.replyToUser(ctx, "Ви не можете змінити статус, бо вас виключено з гри.");
        }
        if (extraAction && (playerInd == -1 || game.players[playerInd].status !== 'joined')) {
            return this.replyToUser(ctx, 'Перед тим як додавати/видаляти ігрока натисніть що Ви самі йдете на гру.');
        }
        let extraPlayer = game.players.length && Math.max(...game.players.map(p => p.id === userId && p.extraPlayer)) || 0;
        if (extraAction) {
            if (extraAction === 'minus') {
                if (extraPlayer <= 0) {
                    return;
                }
                playerInd = game.players.findIndex(p => p.id === userId && p.extraPlayer === extraPlayer);
                game.players.splice(playerInd, 1);
            } else
                extraPlayer++;
        } else {
            if (playerInd >= 0) {
                if (game.players[playerInd].status === newStatus) {
                    return;
                }
                if (extraPlayer > 0) {
                    return this.replyToUser(ctx, 'Перед тим як змінювати свій статус видмініть похід на гру для додаткових ігроків, яких ви залучили.');
                }
                game.players.splice(playerInd, 1);
            }
        }

        if (extraAction !== 'minus')
            game.players.push({ id: userId, name: username, extraPlayer, status: newStatus, timestamp });
        game.players.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        await this.database.updateGame(game._id, { players: game.players });

        this.updateGameMessage(game, gameId);
    }

    buildTextMessage(game) {
        const players = game.players || [];
        const m = (user) => (user.name[0] != '@' && user.name.indexOf(' ') == -1 ? '@' : '') + user.name +
            (user.extraPlayer ? '(+' + user.extraPlayer + ')': '');
        return textMarkdownNormalize(
            (!game.isActive ? '‼️ НЕАКТИВНА ‼️\n\n' : '') +
            `📅 **${game.name} (${date2text(game.date)})**\n\n` +
            `👥 Кількість учасників ${players.filter(p => p.status === 'joined').length}/${game.maxPlayers}\n` +
            `✅ Йдуть: ${players.filter(p => p.status === 'joined').slice(0, game.maxPlayers).map(p => `${m(p)}`).join(', ') || '-'}\n` +
            `⏳ У черзі: ${players.filter(p => p.status === 'joined').slice(game.maxPlayers).map(p => `${m(p)}`).join(', ') || '-'}\n` +
            `❓ Думають: ${players.filter(p => p.status === 'pending').map(p => `${m(p)}`).join(', ') || '-'}\n` +
            `❌ Не йдуть: ${players.filter(p => p.status === 'declined').map(p => `${m(p)}`).join(', ') || '-'}\n\n` +
            `✍️ Опубліковано ${game.createdByName}`
        );
    }

    buildMarkup(gameId) {
        return Markup.inlineKeyboard([
            Markup.button.callback('✅ Йду', `join_${gameId}`),
            Markup.button.callback('❓ Подумаю', `pending_${gameId}`),
            Markup.button.callback('❌ Не йду', `decline_${gameId}`),
            Markup.button.callback('✅ Йду +', `join_${gameId}_plus`),
            Markup.button.callback('❌ Не йду -', `decline_${gameId}_minus`)
        ], {columns: 3});
    }

    async updateGameMessage(game, gameId) {
        if (!game) return;

        try {
            return await this.bot.telegram.editMessageText(
                game.chatId,
                game.messageId,
                null,
                this.buildTextMessage(game),
                { parse_mode: 'Markdown', ...this.buildMarkup(gameId) }
            );
        } catch (error) {
            console.error(error);
        }
    }

    async writeGameMessage(ctx, game, gameId) {
        if (!game) return;
        return await this.replyOrDoNothing(ctx, this.buildTextMessage(game), { parse_mode: 'Markdown', ...this.buildMarkup(gameId) });
    }

    async replyToUser(ctx, message) {
        const replyWarning = (ctx) => this.replyOrDoNothing(ctx, `Для отримання повідомлень від бота перейдіть на нього ${this.botUrl} та натисніть Start.`);
        const userId = ctx.from.id;
        const user = await this.database.getUser(userId);
        if (user && user.started) {
            try {
                await this.bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
            } catch (error) {
                if (error?.code === 403) {
                    replyWarning(ctx);
                    await this.database.updateUser({...ctx.from, started: false, startedTimestamp: new Date()});
                } else
                    this.replyOrDoNothing(ctx, message);
            }
        } else
            replyWarning(ctx);
    }

    async replyToUserDirectOrDoNothing(ctx, message) {
        const userId = ctx.from.id;
        const user = await this.database.getUser(userId);
        let sent = false;
        try {
            await this.bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
            sent = true;
        } catch (error) {
            if (error?.code === 403) {
                await this.database.updateUser({...ctx.from, started: false, startedTimestamp: new Date()});
                return;
            }
            console.error(error);
        }
        if (sent && !user?.started) await this.database.updateUser({...ctx.from, started: true, startedTimestamp: new Date()});
    }

    async replyOrDoNothing(ctx, message, extra) {
        try {
            return await ctx.reply(message, extra);
        } catch (error) {
            console.error(error);
        }
    }

    async sendMessage(chatId, message, options = {}) {
        return await this.bot.telegram.sendMessage(chatId, message, options);
    }

    async launch(config, onLaunch) {
        return await this.bot.launch(config, onLaunch);
    }

    async createWebhook(config) {
        return await this.bot.createWebhook(config);
    }

    stop(signal) {
        this.bot.stop(signal);
    }

    get botInfo() {
        return this.bot.botInfo;
    }

    set botInfo(info) {
        this.bot.botInfo = info;
    }

    get webhookServer() {
        return this.bot.webhookServer;
    }

    set webhookServer(server) {
        this.bot.webhookServer = server;
    }

    get telegram() {
        return this.bot.telegram;
    }

    setBotInfo(botName, botUrl) {
        this.botName = botName;
        this.botUrl = botUrl;
        if (this.webServer) {
            this.webServer.updateExtra({ botName, botUrl });
        }
    }

    async makeChatSettings(chatId, ctx) {
        const config = { license: this.config.licenseClientDefault || 'free', timezone: this.config.timezoneClientDefault };
        const chatSettings = {
            chatId,
            chatName: ctx.chat.title,
            allMembersAreAdministrators: ctx.chat.all_members_are_administrators,
            license: config.license,
            botStatus: 'unknown',
            reminders: [],
            admins: [],
            permissions: [],
            features: [],
            timezone: config.timezone
        }
        if (!chatSettings.allMembersAreAdministrators) {
            const admins = await this.bot.telegram.getChatAdministrators(chatId);
            if (admins && admins.length) {
                chatSettings.admins = admins.map(adm => {
                    return {
                        id: adm.user.id,
                        name: extractUserTitle(adm.user)
                    }
                });
            }
        }
        return chatSettings;
    }

    async hasSuitedLicense(chatSettings, cmdName) {
        const license = (await this.database.getLicenses()).find(elem => elem.type === chatSettings.license);
        if (license) {
            return !!license.commands.find(elem => elem === cmdName);
        }
        return false;
    }

    hasPermission(chatSettings, cmdName, userId, createdById, valueIfNoFoundCommand = true) {
        const cmdPermission = chatSettings.permissions.find(elem => elem.command === cmdName);
        if (!cmdPermission) return valueIfNoFoundCommand;

        const appliesTo = cmdPermission.appliesTo.split(',');
        if (appliesTo.some(v => v === 'all')) return true;

        let users = [];
        for (let item of appliesTo) {
            if (item === 'admins') users.push(...chatSettings.admins);
            else if (item === 'specificUsers') users.push(...cmdPermission.users);
            else if (item === 'author' && createdById) users.push({ id: createdById });
        }
        return users.some(usr => usr.id === userId);
    }

    async isSuperAdmin(userId) {
        return (await this.database.getGlobalSettings())?.superAdminId == userId;
    }
}

module.exports = Bot;

