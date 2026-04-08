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
    isNumeric,
    extractStartTime,
    extractDate,
    normalizeParsedDate,
    parseArgs,
    strBefore,
    strAfter,
    splitWithTail,
    extractPlayers,
    parseDateWithTimezone,
    getDigitGroupCount
} = require('../helpers/utils');
const { Temporal } = require('@js-temporal/polyfill');

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
        this.setupChatMembers();
    }

    setupCommands() {
        const getCmds = (cmd) => {
            let item = this.botCommands[cmd];
            if (!item || !item.aliases) return cmd;
            return [cmd, ...item.aliases]
        }
        this.bot.command('start', this.handleStart.bind(this));
        this.bot.command('help', this.handleHelp.bind(this));
        this.bot.command(getCmds('add_game'), this.handleAddGame.bind(this));
        this.bot.command(['del_game', 'del-game', 'delgame'], this.handleDelGame.bind(this));
        this.bot.command(['change_game', 'change-game', 'changegame'], this.handleChangeGame.bind(this));
        this.bot.command('kick', this.handleKickFromGame.bind(this));
        this.bot.command(['active_games', 'games', 'active-games', 'activegames'], this.handleActiveGames.bind(this));
        this.bot.command('settings', this.handleSettings.bind(this));
        this.bot.command(['change_settings', 'change-settings', 'changesettings'], this.handleChangeSettings.bind(this));
        this.bot.command('ver', this.handleGetVersion.bind(this));
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
                this.updateChatStatus(chatId, newStatus);
            } else if (newStatus === 'member') {
                console.log(`Бот доданий до чату ${chatId}`);
                this.updateChatStatus(chatId, newStatus, ctx);
            }
        });
    }

    setupChatMembers() {
        this.bot.on('new_chat_members', (ctx) => {
            // В масиві new_chat_members може бути кілька користувачів (якщо їх додали пачкою)
            const newMembers = ctx.message.new_chat_members;
            // Отримуємо ID чату
            const chatId = ctx.chat.id;
            // Отримуємо назву чату (групи)
            const chatTitle = ctx.chat.title;
            console.log(`Новий учасник у групі: ${chatTitle} (ID: ${chatId})`);
            newMembers.forEach((user) => {
                const name = user.username ? `@${user.username}` : user.first_name;
                //ctx.reply(`Вітаємо в групі, ${name}! 👋`);
                console.log(`Новий користувач: ${name} (ID: ${user.id})`);
            });
        });

        this.bot.on('chat_member', (ctx) => {
            const oldStatus = ctx.chatMember.old_chat_member.status;
            const newStatus = ctx.chatMember.new_chat_member.status;

            if (oldStatus === 'left' && newStatus === 'member') {
                ctx.reply(`Користувач ${ctx.chatMember.from.first_name} приєднався!`);
            } else
                ctx.reply(`Користувач ${ctx.chatMember.from.first_name} змінив статус ${oldStatus} з на ${newStatus}!`);
        });

        // 1. Обробка входу нових учасників
        // this.bot.on('new_chat_members', (ctx) => {
        //     // new_chat_members — це масив, бо за раз можуть додати кількох людей
        //     const newMembers = ctx.message.new_chat_members;

        //     newMembers.forEach((user) => {
        //         const name = user.username ? `@${user.username}` : user.first_name;
        //         console.log(`Новий користувач: ${name} (ID: ${user.id})`);

        //         ctx.reply(`Ласкаво просимо, ${name}! 👋`);
        //     });
        // });

        // 2. Обробка виходу або видалення учасника
        this.bot.on('left_chat_member', (ctx) => {
            // Отримуємо ID чату
            const chatId = ctx.chat.id;
            // Отримуємо назву чату (групи)
            const chatTitle = ctx.chat.title;
            console.log(`Учасник пішов з групи: ${chatTitle} (ID: ${chatId})`);
            const user = ctx.message.left_chat_member;
            const name = user.username ? `@${user.username}` : user.first_name;

            console.log(`Користувач пішов: ${name} (ID: ${user.id})`);

            //ctx.reply(`${name} покинув чат. До зустрічі! 😢`);
        });
    }

    async handleStart(ctx) {
        const chatId = this.getChatId(ctx);
        if (this.isGroup(chatId)) return; // Ця команда має сенс лише у чаті з користувачем, а не у групових

        this.updateChatStatus(chatId, 'member', ctx);

        let message = this.botCommands['start']?.description;
        if (!message) return;

        let tpl = eval('`'+message+'`');
        this.sendMessageEx(chatId, tpl, { parse_mode: 'Markdown' });
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
        const chatId = this.getChatId(ctx);
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
        if (!await this.isSuperAdmin(ctx)) return;

        let [_, ...args] = splitWithTail(ctx.message.text, 3);

        const userOrChatId = parseInt(args[0], 10);
        if (Number.isNaN(userOrChatId)) return this.replyOrDoNothing(ctx, this.emoji.warn + 'Передане некоректе id користувача/групи.');

        const message = args[1];
        this.sendMessageEx(userOrChatId, message);
    }

    async handleGetAdm(ctx) {
        this.replyToUserDirectOrDoNothing(ctx, String((await this.database.getGlobalSettings())?.superAdminId));
    }

    async handleDeleteMessage(ctx) {
        if (!await this.isSuperAdmin(ctx)) return;
        let [_, chatId, messageId] = str2params(ctx.message.text);

        try {
            await this.bot.telegram.deleteMessage(chatId, messageId);
        } catch (error) {
            return this.replyToUserDirectOrDoNothing(ctx, error);
        }
        return this.replyToUserDirectOrDoNothing(ctx, 'Повідомлення видалено.');
    }

    async handleAddGame(ctx) {
        const chatId = this.getChatId(ctx);
        if (!this.isGroup(chatId)) {
            return this.replyToUserDirectOrDoNothing(ctx, this.emoji.err + 'Ця команда доступна тільки для груп!');
        }

        const msgText = ctx.message.text;
        let [cmdName, ...args] = str2params(msgText);
        cmdName = cmdName.slice(1);

        const chatSettings = await this.database.getChatSettings(chatId) || {};
        if (!await this.ensureAccess(ctx, this.getUserId(ctx), chatId, null, cmdName, chatSettings)) return;

        // TODO: /game Гра у форматі 8/12, вівторок -l1=1-8 -p1=8 -l2=9-12 -p2=4
        let { error, name, maxPlayers, date, isDateWithoutTime, subgames } = this.parseGameData(args, chatSettings);
        if (error) return error;
        // const onlyGameName = (args.length != 3 || !isNumeric(args[2]));
        // if (!onlyGameName)
        //     if (args.length < 3) return this.replyWarning(ctx, cmdName, 'Передана недостатня кількість параметрів.');
        //     else if (args.length > 3) return this.replyWarning(ctx, cmdName, 'Передана некоректа кількість параметрів. ' + (occurrences(msgText, '"') > 2 ? 'Скоріше проблема з використанням подвійних лапок ("). ' : ''));

        // let name;
        // let maxPlayers;
        // let date;
        // let isDateWithoutTime;
        // if (onlyGameName) {
        //     const index = msgText.indexOf(' ');
        //     if (index == -1) return this.replyOrDoNothing(ctx, 'Не вказана назва гри.');

        //     name = msgText.substring(index + 1);
        //     isDateWithoutTime = true;
        //     let stringDate = extractDate(name);
        //     if (!stringDate) {
        //         // намагання отримати дату через слова, що мають сенс дати
        //         stringDate = parseDateWithTimezone(name);
        //     }
        //     if (stringDate && stringDate.match(/\d+/g).length === 3) {
        //         const time = extractStartTime(name);
        //         if (time) stringDate += ' ' + time;
        //     }
        //     if (stringDate) {
        //         const parsedDate = this.parseDateByChatSettings(stringDate, chatSettings);
        //         if (!parsedDate) return this.replyOrDoNothing(ctx, this.invalidDateFormatMessage);
        //         date = new Date(parsedDate);

        //         isDateWithoutTime = stringDate.match(/\d+/g).length < 4;
        //     }
        //     maxPlayers = extractPlayers(msgText);
        // } else {
        //     name = args[0];
        //     let stringDate = args[1];
        //     if (stringDate.match(/\d+/g).length === 3) {
        //         const time = extractStartTime(name);
        //         if (time) stringDate += ' ' + time;
        //     }
        //     const parsedDate = this.parseDateByChatSettings(stringDate, chatSettings);
        //     if (!parsedDate) return this.replyOrDoNothing(ctx, this.invalidDateFormatMessage);
        //     date = new Date(parsedDate);

        //     maxPlayers = parseInt(args[2]);
        //     if (!maxPlayers || maxPlayers <= 0) return this.replyOrDoNothing(ctx, 'Кількість ігроків повинно бути числом більше 0.');

        //     isDateWithoutTime = stringDate.match(/\d+/g).length < 4;
        // }

        const creatorId = this.getUserId(ctx);
        const creatorName = extractUserTitle(ctx.from, false);
        const chatName = ctx.chat.title;

        const game = {
            createdDate: new Date(),
            createdById: creatorId,
            createdByName: creatorName,
            isActive: true,
            chatId,
            chatName,
            name,
            date,
            isDateWithoutTime,
            maxPlayers,
            players: [],
            subgames
        };
        console.log(`Now ${new Date()}`);
        console.log(`Converted Date ${game.date}`);
        console.log(`Game ${game.name}`);

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

        if (args.length < 1) return this.replyWarning(ctx, cmdName, 'Не переданий ідентифікатор гри.');

        const gameId = args[0];
        const game = await this.database.getGame(gameId);
        if (!game) return;

        const chatId = game.chatId;
        if (!await this.ensureAccess(ctx, this.getUserId(ctx), chatId, game.createdById, cmdName)) return;

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

        if (args.length < 2) return this.replyWarning(ctx, cmdName, 'Передана недостатня кількість параметрів.');

        const gameId = args.shift();
        const game = await this.database.getGame(gameId);
        if (!game) return;

        const chatId = game.chatId;
        const chatSettings = await this.database.getChatSettings(chatId) || {};
        if (!await this.ensureAccess(ctx, this.getUserId(ctx), chatId, game.createdById, cmdName, chatSettings)) return;

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
                //const parsedDate = this.parseDateByChatSettings(stringDate, chatSettings);
                const parsedDate = parseDate(stringDate, chatSettings.timezone || chatSettings.timezoneOffset);
                if (!parsedDate) return this.replyToUserDirectOrDoNothing(ctx, this.invalidDateFormatMessage);
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

        if (args.length < 2) return this.replyWarning(ctx, cmdName, 'Передана недостатня кількість параметрів.');

        const gameId = args.shift();
        const game = await this.database.getGame(gameId);
        if (!game) return;

        const chatId = game.chatId;
        if (!await this.ensureAccess(ctx, this.getUserId(ctx), chatId, game.createdById, cmdName)) return;

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
        const chatId = this.getChatId(ctx);
        const userId = this.getUserId(ctx);
        const filter = { isActive: true };
        let where = '';
        if (this.isGroup(chatId)) {
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
                let status = this.isGroup(chatId) ? ' Ще не має статусу' : '';
                let ind = game.players.filter(p => p.status === 'joined').sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).findIndex(p => p.id === userId);
                let limit = game.maxPlayers || Infinity;
                if (ind >= 0 && ind < limit) status = '✅ Йду';
                if (ind >= 0 && ind >= limit) status = '⏳ У черзі';
                if (game.players.some(p => p.id === userId && p.status === 'pending')) status = '❓ Думаю';
                if (game.players.some(p => p.id === userId && p.status === 'declined')) status = '❌ Не йду';
                if (game.players.some(p => p.id === userId && p.status === 'kicked')) status = "🦶 Вас виключено";
                if (status) {
                    let dateText = game.date ? ` (${date2text(game.date)})` : '';
                    lines.push({gameDate, text: `📅 ${game.name}${dateText} - ${status}`});
                }
            });
            if (lines.length) {
                lines.sort((a, b) => (a.gameDate || 0) - (b.gameDate || 0));
                response = `📋 **Активні ігри${where}:**\n\n` + lines.map(elem => elem.text).join('\n' + '—'.repeat(18) + '\n');
            }
        }
        this.replyToUser(ctx, response);
    }

    async handleSettings(ctx) {
        const chatId = this.getChatId(ctx);
        if (this.isGroup(chatId)) return; // Ця команда тільки для чату користувача

        const userId = this.getUserId(ctx);
        const user = await this.database.getUserFromDB(userId);
        try {
            await this.bot.telegram.sendMessage(userId, JSON.stringify(user.settings || {}, null, 2));
        } catch (error) {
            console.error(`[Telegram Error] Chat ${userId}:`, error.message);
        }
    }

    async handleChangeSettings(ctx) {
        const chatId = this.getChatId(ctx);
        if (this.isGroup(chatId)) return; // Ця команда тільки для чату користувача

        const userId = this.getUserId(ctx);
        let [_, ...args] = parseArgs(ctx.message.text);
        if (args.length != 1) return await this.sendMessage(userId, this.emoji.warn + 'Передана некоректа кількість параметрів.');
        const key = strBefore(args[0], '=');
        const value = strAfter(args[0], '=');
        if (key in ['timezone', 'notificationTerms']) return await this.sendMessage(userId, this.emoji.warn + 'Передана некоректе им\'я налаштування.');
        let keyValueObj;
        try {
            keyValueObj = JSON.parse('{"' + key + '":' + value + '}');
        } catch (error) {
            console.error(error);
            await this.sendMessage(userId, this.emoji.warn + 'Некоректне значення налаштування.');
            return;
        }
        if (key === 'timezone') {
            let timeZones = Intl.supportedValuesOf('timeZone');
            timeZones.push('Europe/Kyiv'); // тому що у цьому списку може бути тільки "Europe/Kiev"
            if (!timeZones.find(v => v === keyValueObj[key])) {
                await this.sendMessage(userId, this.emoji.warn + 'Некоректне значення налаштування. Доспупні значення: ' + JSON.stringify(timeZones));
                return;
            }
        }
        await this.database.updateUser({ ...ctx.from, settings: keyValueObj }, true);
        await this.sendMessage(userId, this.emoji.info + `Налаштування ${key} оновлене.`);
    }

    async updateGameStatus(ctx, action) {
        const [gameLeagueId, extraAction] = ctx.match[1].split('_');
        const [gameId, subgameIndex] = gameLeagueId.split('/');
        const userId = this.getUserId(ctx);
        const username = extractUserTitle(ctx.from);
        const fullName = extractUserTitle(ctx.from, false);
        const timestamp = new Date();

        const game = await this.database.getGame(gameId);
        if (!game || !game.isActive) return;

        const newStatus = getStatusByAction(action);
        let playerInd = game.players.findIndex(p => p.id === userId && !p.extraPlayer && (!subgameIndex || p.subgameIndex === +subgameIndex));
        if (playerInd != -1 && game.players[playerInd].status === 'kicked') {
            return this.replyToUser(ctx, "Ви не можете змінити статус, бо вас виключено з гри.");
        }
        if (extraAction && (playerInd == -1 || game.players[playerInd].status !== 'joined')) {
            return this.replyToUser(ctx, 'Перед тим як додавати/видаляти ігрока натисніть що Ви самі йдете на гру.');
        }
        let extraPlayer = game.players.length && Math.max(...game.players.map(p => p.id === userId && p.extraPlayer && (!subgameIndex || p.subgameIndex === +subgameIndex))) || 0;
        if (extraAction) {
            if (extraAction === 'minus') {
                if (extraPlayer <= 0) {
                    return;
                }
                playerInd = game.players.findIndex(p => p.id === userId && p.extraPlayer === extraPlayer && (!subgameIndex || p.subgameIndex === +subgameIndex));
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
                } else if (newStatus === 'joined' && subgameIndex) {
                    const playersItem = game.players.find(p => p.id === userId && !p.extraPlayer && p.subgameIndex !== +subgameIndex && p.status === newStatus);
                    if (playersItem) return this.replyToUser(ctx, 'Ви вже йдете на гру ' + game.subgames[playersItem.subgameIndex]?.name + '.');
                }
                game.players.splice(playerInd, 1);
            }
        }

        if (extraAction !== 'minus')
            game.players.push({ id: userId, name: username, fullName: fullName, extraPlayer, status: newStatus, timestamp, subgameIndex: parseInt(subgameIndex) || 0 });
        game.players.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        await this.database.updateGame(game._id, { players: game.players });

        this.updateGameMessage(game, gameId);
    }

    buildTextMessage(game) {
        const players = game.players || [];
        const m = (user) => {
            const extra = (user.extraPlayer ? ' (+)' : '');
            return `[${user.fullName || user.name}${extra}](tg://user?id=${user.id})`;
        };
        const limit = game.maxPlayers || Infinity;
        const dateText = game.date ? ` (${date2text(game.date)})` : '';
        let gameText = '';
        if (game.subgames && game.subgames.length > 1) {
            for (let ind = 0; ind < game.subgames.length; ind++) {
                let subgame = game.subgames[ind];
                gameText +=
                `🏆 ${subgame.name}\n` +
                `👥 Кількість учасників ${players.filter(p => p.status === 'joined' && p.subgameIndex === ind).length}${subgame.maxPlayers ? '/' + subgame.maxPlayers : ''}\n` +
                `✅ Йдуть: ${players.filter(p => p.status === 'joined' && p.subgameIndex === ind).slice(0, limit).map(p => `\n✅ ${m(p)}`).join(', ') || '-'}\n` +
                `⏳ У черзі: ${players.filter(p => p.status === 'joined' && p.subgameIndex === ind).slice(limit).map(p => `\n⏳ ${m(p)}`).join(', ') || '-'}\n` +
                `❓ Думають: ${players.filter(p => p.status === 'pending' && p.subgameIndex === ind).map(p => `\n❓ ${m(p)}`).join(', ') || '-'}\n` +
                `❌ Не йдуть: ${players.filter(p => p.status === 'declined' && p.subgameIndex === ind).map(p => `\n❌ ${m(p)}`).join(', ') || '-'}\n\n`;
            }
        } else {
            gameText += `👥 Кількість учасників ${players.filter(p => p.status === 'joined').length}${game.maxPlayers ? '/' + game.maxPlayers : ''}\n` +
            `✅ Йдуть: ${players.filter(p => p.status === 'joined').slice(0, limit).map(p => `\n✅ ${m(p)}`).join(', ') || '-'}\n` +
            `⏳ У черзі: ${players.filter(p => p.status === 'joined').slice(limit).map(p => `\n⏳ ${m(p)}`).join(', ') || '-'}\n` +
            `❓ Думають: ${players.filter(p => p.status === 'pending').map(p => `\n❓ ${m(p)}`).join(', ') || '-'}\n` +
            `❌ Не йдуть: ${players.filter(p => p.status === 'declined').map(p => `\n❌ ${m(p)}`).join(', ') || '-'}\n\n`;
        }
        return textMarkdownNormalize(
            (!game.isActive ? '‼️ НЕАКТИВНА ‼️\n\n' : '') +
            `📅 ${game.name}${dateText}\n\n` + gameText +
            `✍️ Опубліковано ${game.createdByName}`
        );
    }

    async buildMarkup(gameId) {
//         return Markup.inlineKeyboard([
//     // Перша група (1-5)
//     [Markup.button.callback('1', 'n_1'), Markup.button.callback('2', 'n_2'), Markup.button.callback('3', 'n_3'), Markup.button.callback('4', 'n_4'), Markup.button.callback('5', 'n_5')],

//     // РОЗДІЛЬНИК (кнопка з текстом, яка нікуди не веде)
//     [Markup.button.callback('─── Наступна група ───', 'none')],

//     // Друга група (6-10)
//     [Markup.button.callback('6', 'n_6'), Markup.button.callback('7', 'n_7'), Markup.button.callback('8', 'n_8'), Markup.button.callback('9', 'n_9'), Markup.button.callback('10', 'n_10')]
// ]);
        // return Markup.inlineKeyboard([
        //     Markup.button.callback('✅ Йду', `join_${gameId}`),
        //     Markup.button.callback('❓ Подумаю', `pending_${gameId}`),
        //     Markup.button.callback('❌ Не йду', `decline_${gameId}`),
        //     Markup.button.callback('✅ +1', `join_${gameId}_plus`),
        //     Markup.button.callback('❌ -1', `decline_${gameId}_minus`)
        // ], {columns: 3});
        const game = await this.database.getGame(gameId);
        // console.log(game);
        if (!game.subgames || game.subgames.length <= 1) {
            return Markup.inlineKeyboard([
                Markup.button.callback('✅ Йду', `join_${gameId}`),
                Markup.button.callback('❓ Думаю', `pending_${gameId}`),
                Markup.button.callback('❌ Не йду', `decline_${gameId}`),
                Markup.button.callback('✅ +1', `join_${gameId}_plus`),
                Markup.button.callback('❌ -1', `decline_${gameId}_minus`)
            ], {columns: 3});
        }

        // Підтримка ліг, або підігр
        const buttons = [];
        for (let ind = 0; ind < game.subgames.length; ind ++) {
            let subgame = game.subgames[ind];
            buttons.push([Markup.button.callback(`⬇⬇ ${subgame.name} ⬇⬇`, 'none')]);
            buttons.push([
                Markup.button.callback('✅ Йду', `join_${gameId}/${ind}`),
                Markup.button.callback('❓ Думаю', `pending_${gameId}/${ind}`),
                Markup.button.callback('❌ Не йду', `decline_${gameId}/${ind}`)
            ]);
            buttons.push([
                Markup.button.callback('✅ +1', `join_${gameId}/${ind}_plus`),
                Markup.button.callback('❌ -1', `decline_${gameId}/${ind}_minus`)
            ]);
        }
        return Markup.inlineKeyboard(buttons);
    }

    async updateGameMessage(game, gameId) {
        if (!game) return;
        // console.log('game');
        // console.log(game);
        // console.log('gameId');
        // console.log(gameId);

        try {
            return await this.bot.telegram.editMessageText(
                game.chatId,
                game.messageId,
                null,
                this.buildTextMessage(game),
                { parse_mode: 'Markdown', link_preview_options: {is_disabled: true}, ...(await this.buildMarkup(gameId)) }
            );
        } catch (error) {
            console.error(error);
        }
    }

    async writeGameMessage(ctx, game, gameId) {
        if (!game) return;
        return await this.replyOrDoNothing(ctx, this.buildTextMessage(game), { parse_mode: 'Markdown', link_preview_options: {is_disabled: true}, ...(await this.buildMarkup(gameId)) });
    }

    get invalidDateFormatMessage() {
        return this.emoji.warn + 'Дату треба вказувати у такому форматі: 2025-03-25 або "2025-03-25 11:00"';
    }

    parseDateByChatSettings(stringDate, chatSettings = {}) {
        if (chatSettings.timezone) {
            const isoString = stringDate.replace(/\./g, '-').replace(' ', 'T').replace(/T(\d):/, "T0$1:"); // T9:00 -> T09:00
            return Temporal.ZonedDateTime.from(`${isoString}[${chatSettings.timezone}]`).toInstant().toString();
        }
        return parseDate(stringDate, chatSettings.timezone || chatSettings.timezoneOffset);
    }

    async getOrCreateChatSettings(ctx, chatId) {
        let chatSettings = await this.database.getChatSettings(chatId);
        if (!chatSettings && this.isGroup(chatId)) {
            chatSettings = await this.makeChatSettings(chatId, ctx);
            await this.database.createChatSettings(chatSettings);
        }
        return chatSettings;
    }

    async ensureAccess(ctx, userId, chatId, createdById, cmdName, chatSettings) {
        if (await this.isSuperAdmin(userId)) return true;

        if (chatSettings == null) chatSettings = {};
        Object.assign(chatSettings, await this.getOrCreateChatSettings(ctx, chatId));
        return await this.ensureCommandAccess(ctx, chatSettings, cmdName, userId, createdById);
    }

    async ensureCommandAccess(ctx, chatSettings, cmdName, userId, createdById, valueIfNoFoundCommand = true) {
        if (!(await this.hasSuitedLicense(chatSettings, cmdName))) {
            await this.replyToUserDirectOrDoNothing(ctx, this.emoji.noaccess + 'Недостатня ліцензія на використання цієї команди.');
            return false;
        }

        if (!this.hasPermission(chatSettings || { permissions: [] }, cmdName, userId, createdById, valueIfNoFoundCommand)) {
            await this.replyToUserDirectOrDoNothing(ctx, this.emoji.noaccess + 'У вас немає повноважень на використання цієї команди.');
            return false;
        }
        return true;
    }

    async replyToUser(ctx, message) {
        //const replyWarning = (ctx) => this.replyOrDoNothing(ctx, `Для отримання повідомлень від бота перейдіть на нього ${this.botUrl} та натисніть Start.`);
        const userId = this.getUserId(ctx);
        const user = await this.database.getUser(userId);
        if (user && user.started) {
            try {
                await this.bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
            } catch (error) {
                this.handleError(error);
                //!!!
                if (error?.code === 403) {
                    //replyWarning(ctx);
                    //await this.database.updateUser({ ...ctx.from, started: false });
                } else
                    this.replyOrDoNothing(ctx, message);
            }
        } //else
            //replyWarning(ctx);
    }

    async replyToUserDirectOrDoNothing(ctx, message) {
        const userId = this.getUserId(ctx);
        const user = await this.database.getUser(userId);
        let sent = false;
        try {
            await this.bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
            sent = true;
        } catch (error) {
            this.handleError(error);
        }
        if (sent && !user?.started)
            this.updateChatStatus(userId, 'member', ctx);
    }

    async replyOrDoNothing(ctx, message, extra) {
        try {
            return await ctx.reply(message, extra);
        } catch (error) {
            console.error(error);
        }
    }

    async sendMessageEx(chatId, message, options = {}) {
        let sent = false;
        try {
            await this.sendMessage(chatId, textMarkdownNormalize(message), { parse_mode: 'Markdown', ...options });
            sent = true;
        } catch (error) {
            this.handleError(error);
        }
        if (sent && !this.isGroup(chatId)) {
            const user = await this.database.getUser(chatId);
            if (user && !user?.started)
                this.updateChatStatus(chatId, 'member');
        }
    }

    async sendMessage(chatId, message, options = {}) {
        const MAX_LENGTH = 4000;

        // Якщо повідомлення коротке — надсилаємо одразу
        if (message.length <= MAX_LENGTH) {
            return await this.bot.telegram.sendMessage(chatId, message, options);
        }

        const chunks = [];
        let currentChunk = "";

        // Розбиваємо за рядками, щоб зберегти читабельність
        const lines = message.split('\n');

        for (const line of lines) {
            // Перевірка: чи не задовгий сам рядок (якщо один рядок > 4000)
            if (line.length > MAX_LENGTH) {
                // Якщо рядок гігантський, ріжемо його примусово по символах
                const subChunks = line.match(new RegExp(`.{1,${MAX_LENGTH}}`, 'g'));
                chunks.push(...subChunks);
                continue;
            }

            if ((currentChunk + line).length > MAX_LENGTH) {
                chunks.push(currentChunk);
                currentChunk = line + "\n";
            } else {
                currentChunk += line + "\n";
            }
        }

        if (currentChunk.trim().length > 0) {
            chunks.push(currentChunk);
        }

        // Надсилаємо всі частини по черзі
        const responses = [];
        for (const chunk of chunks) {
            const res = await this.bot.telegram.sendMessage(chatId, chunk.trim(), options);
            responses.push(res);

            // Невелика затримка, щоб уникнути Flood Wait від Telegram API
            // (актуально для дуже великих текстів на 10+ частин)
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return responses; // Повертаємо масив відповідей від API
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

    getDefaultSettings() {
        return {
            license: this.config.licenseClientDefault || 'free',
            timezone: this.config.timezoneClientDefault,
            notificationTerms: this.config.notificationTerms || '-1440,-60'
        };
    }

    async makeChatSettings(chatId, ctx) {
        const config = this.getDefaultSettings();
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
            timezone: config.timezone,
            notificationTerms: config.notificationTerms
        }
        if (!chatSettings.allMembersAreAdministrators) {
            const admins = this.isGroup(chatId) && await this.bot.telegram.getChatAdministrators(chatId);
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
            const cmdNames = [];
            for (let key of Object.keys(this.botCommands)) {
                let aliases = this.botCommands[key].aliases;
                if (key === cmdName || (aliases && aliases.includes(cmdName))) {
                    cmdNames.push(key, ...(aliases || []));
                }
            }
            if (!cmdNames.length) cmdNames.push(cmdName);
            //console.log(cmdNames);
            return !!license.commands.find(elem => cmdNames.includes(elem));
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

    async isSuperAdmin(userIdOrCtx) {
        const userId = typeof userIdOrCtx === 'number' ? userIdOrCtx : this.getUserId(userIdOrCtx);
        return (await this.database.getGlobalSettings())?.superAdminId == userId;
    }

    getChatId(ctx) {
        return ctx.chat.id;
    }

    getUserId(ctx) {
        return ctx.from.id;
    }

    isGroup(chatId) {
        return chatId < 0;
    }

    handleError(error) {
        console.error(error);

        const chatId = error.on?.payload?.chat_id;
        if (!chatId) return;

        const errorCode = error?.code;
        if (errorCode == 403) {
            // error?.response?.description: 'Forbidden: bot was kicked from the group chat'
            // error?.response?.description: 'Forbidden: bot was blocked by the user'
            const status = 'kicked/blocked';
            this.updateChatStatus(chatId, status);
            return;
        }

        if (errorCode == 400 && (error?.response?.description)?.includes('chat not found')) {
            // error?.response?.description: 'Bad Request: chat not found'
            const status = 'not found';
            this.updateChatStatus(chatId, status);
            return;
        }
    }

    updateChatStatus(chatId, status, ctx) {
        const needToSetDefaultSettings = status === 'member';
        if (this.isGroup(chatId)) {
            this.database.updateChatSettings({ chatId, botStatus: status }, needToSetDefaultSettings ? async () => await this.makeChatSettings(chatId, ctx) : null);
            if (needToSetDefaultSettings) this.replyOrDoNothing(ctx, 'Привіт!\nДякую за додавання мене до групи.\n\nЩоб дізнатися що я вмію відправьте команду /help.');
        }
        else {
            const started = status === 'member';
            this.database.updateUser({ id: chatId, started, ...(needToSetDefaultSettings ? { settings: this.getDefaultSettings() } : {}), ...(started ? ctx.from : {}) });
        }
    }

    replyWarning(ctx, cmdName, warnText) {
        return this.replyOrDoNothing(
            ctx,
            this.emoji.warn + warnText + ' ' + (this.botCommands[cmdName].example || '')
        );
    }

    parseGameData(args, chatSettings) {
        const buildRemainingArgs = (args) => {
            const params = {};
            const remainingArgs = args.filter(item => {
                // Перевіряємо, чи елемент починається з '-' і містить '='
                if (item.startsWith('-') && item.includes('=')) {
                    const [key, value] = item.split('=');
                    // key.slice(1) прибирає дефіс попереду (наприклад, 'l1')
                    params[key.slice(1)] = value;
                    return false; // Видаляємо з основного масиву
                }
                return true; // Залишаємо в тексті
            });
            return { params, remainingArgs };
        }

        const buildSubgames = (params) => {
            const subgames = [];
            let i = 0;
            while (++i) {
                let key = `g${i}`;
                if (!(key in params)) break;
                let name = params[key];
                let stringDate = params[`d${i}`];
                if (!stringDate) stringDate = extractDate(name);
                if (!stringDate) {
                    // намагання отримати дату через слова, що мають сенс дати
                    stringDate = parseDateWithTimezone(name);
                }
                let date = null, isDateWithoutTime = true;
                if (stringDate) {
                    let obj = convertStringDate(stringDate, name);
                    if (!obj.error) date = obj.date, isDateWithoutTime = obj.isDateWithoutTime;
                }
                subgames.push({ name, maxPlayers: parseInt(params[`p${i}`]) || null, date, isDateWithoutTime });
            }
            return subgames;
        }

        const convertStringDate = (stringDate, name) => {
            // Якщо у даті рівно 3 групи цифр (напр. день, місяць, рік) — спробуємо витягнути час
            if (getDigitGroupCount(stringDate) === 3) {
                const time = extractStartTime(name);
                if (time) stringDate += ' ' + time;
            }

            const parsedDate = this.parseDateByChatSettings(stringDate, chatSettings);
            if (!parsedDate) {
                return { error: true };
            }

            let date = new Date(parsedDate);
            // Перевіряємо кількість цифр вже у оновленому stringDate (з доданим часом, якщо він є)
            let isDateWithoutTime = getDigitGroupCount(stringDate) < 4;
            return { date, isDateWithoutTime };
        }

        const gameData = {};
        const { params, remainingArgs } = buildRemainingArgs(args);
        const onlyGameName = (remainingArgs.length != 3 || !isNumeric(remainingArgs[2]));
        if (!onlyGameName)
            if (remainingArgs.length < 3) return gameData.error = this.replyWarning(ctx, cmdName, 'Передана недостатня кількість параметрів.'), gameData;
            else if (remainingArgs.length > 3) return gameData.error = this.replyWarning(ctx, cmdName, 'Передана некоректа кількість параметрів. ' + (occurrences(msgText, '"') > 2 ? 'Скоріше проблема з використанням подвійних лапок ("). ' : '')), gameData;

        let name, maxPlayers, date, isDateWithoutTime, subgames, stringDate;
        // 1. Парсинг аргументів
        if (onlyGameName) {
            if (!remainingArgs.length) {
                gameData.error = this.replyOrDoNothing(ctx, 'Не вказана назва гри.');
                return gameData;
            }

            name = remainingArgs.join(' ');
            stringDate = extractDate(name) || parseDateWithTimezone(name);
            maxPlayers = extractPlayers(name);
        } else {
            name = remainingArgs[0];
            stringDate = remainingArgs[1]; // Може бути undefined, обробимо нижче

            maxPlayers = parseInt(remainingArgs[2], 10);
            if (!maxPlayers || maxPlayers <= 0) {
                gameData.error = this.replyOrDoNothing(ctx, 'Кількість ігроків повинно бути числом більше 0.');
                return gameData;
            }
        }

        // 2. Спільна логіка обробки дати (усунуто дублювання)
        if (stringDate) {
            let obj = convertStringDate(stringDate, name);
            if (obj.error) {
                gameData.error = this.replyOrDoNothing(ctx, this.invalidDateFormatMessage);
                return gameData;
            }
            date = obj.date, isDateWithoutTime = obj.isDateWithoutTime;
        } else if (!onlyGameName) {
            // Якщо це формат без прапорця onlyGameName, але дата не передана — це помилка
            gameData.error = this.replyOrDoNothing(ctx, this.invalidDateFormatMessage);
            return gameData;
        }
        subgames = buildSubgames(params);
        Object.assign(gameData, { name, maxPlayers, date, isDateWithoutTime, subgames });
        return gameData;
    }
}

module.exports = Bot;