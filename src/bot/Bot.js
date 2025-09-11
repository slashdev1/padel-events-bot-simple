const { Telegraf, Markup } = require('telegraf');
const { 
    str2params, 
    date2int, 
    date2text, 
    parseDate, 
    getStatusByAction, 
    textMarkdownNormalize, 
    extractUserTitle, 
    occurrences 
} = require('../../utils');

class Bot {
    constructor(token, database, webServer) {
        this.bot = new Telegraf(token);
        this.database = database;
        this.webServer = webServer;
        this.botName = null;
        this.botUrl = null;
        this.botCommands = require('../../commands-descriptions.json');
        this.emoji = require('../../emoji.json');
        this.package = require('../../package.json');
        
        this.setupCommands();
        this.setupActions();
        this.setupMyChatMember();
    }

    setupCommands() {
        this.bot.command('start', this.handleStart.bind(this));
        this.bot.command('help', this.handleHelp.bind(this));
        this.bot.command('add_game', this.handleAddGame.bind(this));
        this.bot.command('del_game', this.handleDelGame.bind(this));
        this.bot.command('active_games', this.handleActiveGames.bind(this));
        this.bot.command('__ver', this.handleGetVersion.bind(this));
        this.bot.command('__time', this.handleTime.bind(this));
        this.bot.command('__send_to', this.handleSendTo.bind(this));
        this.bot.command('__adm', this.handleGetAdm.bind(this));
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
        const now = new Date();
        this.replyToUserDirectOrDoNothing(ctx, `Час на сервері:\n${now}\n${now.toISOString()}\n${now.toLocaleString()}`);
    }

    async handleSendTo(ctx) {
        if (!await this.isSuperAdmin(ctx.from.id)) return;
        let [_, ...args] = str2params(ctx.message.text);
        this.replyToUserDirectOrDoNothing({from: {id: parseInt(args[0])}}, args[1]);
    }

    async handleGetAdm(ctx) {
        this.replyToUserDirectOrDoNothing(ctx, String((await this.database.getGlobalSettings())?.superAdminId));
    }

    async handleAddGame(ctx) {
        const chatId = ctx.chat.id;
        if (!(chatId < 0)) {
            return this.replyToUserDirectOrDoNothing(ctx, this.emoji.err + 'Ця команда доступна тільки для груп!');
        }
        let [cmdName, ...args] = str2params(ctx.message.text);
        cmdName = cmdName.slice(1);

        if (!await this.isSuperAdmin(ctx.from.id)) {
            let chatSettings = await this.database.getChatSettings(chatId);
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
        
        const stringDate = args[1];
        const parsedDate = parseDate(stringDate);
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
            creatorId,
            creatorName,
            name: args[0],
            date: new Date(parsedDate),
            isDateWithoutTime: stringDate.match(/\d+/g).length < 4,
            maxPlayers: parseInt(args[2]),
            players: []
        };
        
        const gameId = await this.database.createGame(game);
        const message = await this.writeGameMessage(ctx, game, gameId);
        await this.database.updateGame(gameId, { messageId: message.message_id });
        
        const replyText = `Ви щойно створили гру "${args[0]}" (id=${gameId}).` + (game.isDateWithoutTime ? '\n\n' + this.emoji.warn + 'Для того щоб коректно нагадувати та деактивовувати ігри краще зазначати дату ігри разом з часом.' : '');
        this.replyToUserDirectOrDoNothing(ctx, replyText);
    }

    async handleDelGame(ctx) {
        // Важливо: ця команда може запускатись не з групи а напряму боту, тому айді чата береться з гри
        let [cmdName, ...args] = str2params(ctx.message.text);
        cmdName = cmdName.slice(1);
        const gameId = args[0];
        const game = await this.database.getGame(gameId);
        if (!game || !game.isActive) return;
        
        const chatId = game.chatId;
        if (!await this.isSuperAdmin(ctx.from.id)) {
            let chatSettings = await this.database.getChatSettings(chatId);
            if (!chatSettings && ctx.chat.id < 0) {
                chatSettings = await this.makeChatSettings(chatId, ctx);
                await this.database.createChatSettings(chatSettings);
            }
            if (!(await this.hasSuitedLicense(chatSettings, cmdName)))
                return this.replyToUserDirectOrDoNothing(ctx, this.emoji.noaccess + 'Недостатня ліцензія на використання цієї команди.');
            if (!this.hasPermission(chatSettings || { permissions: [] }, cmdName, ctx.from.id)) 
                return this.replyToUserDirectOrDoNothing(ctx, this.emoji.noaccess + 'У вас немає повноважень на використання цієї команди.');
        }
        
        await this.database.deactivateGame(gameId);
        try {
            await this.bot.telegram.deleteMessage(game.chatId, game.messageId);
        } catch (error) {
            if (error?.code === 400) {
                // message to delete not found
            } else
                this.replyOrDoNothing(ctx, message);
        }
        const replyText = `Ви щойно видалили гру "${game.name}" (id=${gameId}).`
        this.replyToUserDirectOrDoNothing(ctx, replyText);
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
            `📅 **${game.name} (${date2text(game.date)})**\n\n` +
            `👥 Кількість учасників ${players.filter(p => p.status === 'joined').length}/${game.maxPlayers}\n` +
            `✅ Йдуть: ${players.filter(p => p.status === 'joined').slice(0, game.maxPlayers).map(p => `${m(p)}`).join(', ') || '-'}\n` +
            `⏳ У черзі: ${players.filter(p => p.status === 'joined').slice(game.maxPlayers).map(p => `${m(p)}`).join(', ') || '-'}\n` +
            `❓ Думають: ${players.filter(p => p.status === 'pending').map(p => `${m(p)}`).join(', ') || '-'}\n` +
            `❌ Не йдуть: ${players.filter(p => p.status === 'declined').map(p => `${m(p)}`).join(', ') || '-'}\n\n` +
            `Опубліковано ${game.creatorName}`
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
        const chatSettings = {
            chatId,
            chatName: ctx.chat.title,
            allMembersAreAdministrators: ctx.chat.all_members_are_administrators,
            license: 'free',
            botStatus: 'unknown',
            reminders: [],
            admins: [],
            permissions: [],
            features: []
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

    hasPermission(chatSettings, cmdName, userId) {
        const cmdPermission = chatSettings.permissions.find(elem => elem.command === cmdName);
        if (cmdPermission) {
            let users = [];
            if      (cmdPermission.appliesTo === 'all') users = undefined;
            else if (cmdPermission.appliesTo === 'admins') users = chatSettings.admins;
            else if (cmdPermission.appliesTo === 'users') users = cmdPermission.users;
            if (users && !users.some(usr => usr.id === userId)) {
                return false;
            }
        }
        return true;
    }

    async isSuperAdmin(userId) {
        return (await this.database.getGlobalSettings())?.superAdminId == userId;
    }
}

module.exports = Bot;

