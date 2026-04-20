const { Telegraf, Markup } = require('telegraf');
const {
    str2params,
    parseDate,
    getStatusByAction,
    textMarkdownNormalize,
    extractUserTitle,
    occurrences,
    isTrue,
    isNumeric,
    extractStartTime,
    extractTimeRangeFromText,
    extractDate,
    normalizeParsedDate,
    parseArgs,
    strBefore,
    strAfter,
    splitWithTail,
    extractPlayers,
    parseDateWithTimezone,
    getDigitGroupCount,
    sleep,
    formatToTimeZone,
    isDate,
    truncateString,
    unescapeString
} = require('../helpers/utils');
const { Temporal } = require('@js-temporal/polyfill');
const { GameStatus } = require('./Database');

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
        this.setupTextHandler();
    }

    // Для кнопок з вводом тексту
    waitingInput = {}; // { userId: { messageId, type, gameId, chatId } }
    currentMarkup = {}; // { messageId: markup }

    setupCommands() {
        this.bot.command('start', this.handleStart.bind(this));
        this.bot.command('help', this.handleHelp.bind(this));
        this.bot.command(this.getCmdsByMainName('add_game'), this.handleAddGame.bind(this));
        this.bot.command(this.getCmdsByMainName('del_game'), this.handleDelGame.bind(this));
        this.bot.command(this.getCmdsByMainName('change_game'), this.handleChangeGame.bind(this));
        this.bot.command('kick', this.handleKickFromGame.bind(this));
        this.bot.command(this.getCmdsByMainName('active_games'), this.handleActiveGames.bind(this));
        this.bot.command('settings', this.handleSettings.bind(this));
        this.bot.command(this.getCmdsByMainName('change_settings'), this.handleChangeSettings.bind(this));
        this.bot.command('ver', this.handleGetVersion.bind(this));
        this.bot.command('__time', this.handleTime.bind(this));
        this.bot.command('__send_to', this.handleSendTo.bind(this));
        this.bot.command('__adm', this.handleGetAdm.bind(this));
        this.bot.command('__del_msg', this.handleDeleteMessage.bind(this));
        this.bot.command('__refresh_game_msg', this.handleRefreshGameMessage.bind(this));
    }

    setupActions() {
        this.bot.action(/^join_(.*)$/, (ctx) => this.updateGameStatus(ctx, 'join'));
        this.bot.action(/^pending_(.*)$/, (ctx) => this.updateGameStatus(ctx, 'pending'));
        this.bot.action(/^decline_(.*)$/, (ctx) => this.updateGameStatus(ctx, 'decline'));
        this.bot.action(/^activation_(.*)$/, (ctx) => this.handleGameActivation(ctx));
        this.bot.action(/^notification_(.*)$/, (ctx) => this.handleGameNotification(ctx));
        this.bot.action(/^setup_(.*)$/, (ctx) => this.handleGameSetup(ctx));
        this.bot.action(/^none$/, (ctx) => this.showPopup(ctx, this.emoji.warn + 'Натискайте на кнопки нище.'));

        this.bot.action(/^activate_(.*)$/, (ctx) => this.handleGameOpening(ctx));
        this.bot.action(/^disactivate_(.*)$/, (ctx) => this.handleGameClosing(ctx));
        this.bot.action(/^edit_game_maxPlayers_(.*)$/, (ctx) => this.handleGameChanging(ctx, 'players'));
        this.bot.action(/^edit_game_date_(.*)$/, (ctx) => this.handleGameChanging(ctx, 'date'));
        this.bot.action(/^edit_game_name_(.*)$/, (ctx) => this.handleGameChanging(ctx, 'name'));

        this.bot.action(/^settings_(.*)$/, (ctx) => this.handleShowSettings(ctx));
        this.bot.action(/^back_to_settings_(.*)$/, (ctx) => this.handleBackToShowSettings(ctx));
        this.bot.action(/^edit_settings_tz_(.*)$/, (ctx) => this.handleSettingsChanging(ctx, 'tz'));
        this.bot.action(/^edit_settings_notif_(.*)$/, (ctx) => this.handleSettingsChanging(ctx, 'notif'));
        this.bot.action(/^edit_settings_allowVotePlusWO_(.*)$/, (ctx) => this.handleSettingsChanging(ctx, 'allowVotePlusWO'));
        this.bot.action(/^set_settings_tz_(.*)$/, (ctx) => this.handleSettingsSetTimeZone(ctx));
        this.bot.action(/^set_settings_notif_(.*)$/, (ctx) => this.handleSettingsSetNotificationTerms(ctx));
        this.bot.action(/^set_settings_allowVotePlusWO_(.*)$/, (ctx) => this.handleSettingsSetAllowVotePlusWO(ctx));
        this.bot.action(/^permissions_(.*)$/, (ctx) => this.showPopup(ctx, this.emoji.info + ' Даний функціонал у розробці. Слідкуйте за оновленнями.'));
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

    setupTextHandler() {
        this.bot.on('text', async (ctx) => {
            console.log(`Повідомлення від ${extractUserTitle(ctx.from)} (id=${this.getUserId(ctx)}): ` + ctx.message.text);

            const input = this.waitingInput[ctx.from.id];
            if (!input) return;

            const { type, gameId, chatId, messageId } = input;
            if (gameId) {
                const game = await this.database.getGameWithPlayers(gameId);
                if (!game) return;

                let update = { [type]: ctx.message.text };
                delete(this.waitingInput[ctx.from.id]);

                const result = await this._changeGame(ctx, game, update);
                if (result !== true) return;

                ctx.reply(this.emoji.info + 'Гру змінено.');
                return;
            }

            if (!chatId) return;

            if (type === 'timezone') {
                ctx.match = [null, `${ctx.message.text}_${chatId}`];
                this.handleSettingsSetTimeZone(ctx, messageId);
            } else if (type === 'notificationTerms') {
                ctx.match = [null, `${ctx.message.text}_${chatId}`];
                this.handleSettingsSetNotificationTerms(ctx, messageId);
            }
            delete(this.waitingInput[ctx.from.id]);
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
                    let example = cmd.example || '';
                    let aliases = cmd.aliases ? 'Аналогічні команди: ' + cmd.aliases.map(v => `/${v}`).join(', ') : '';
                    let text = cmd.description;
                    if (example) text += ' ' + example;
                    if (aliases) text += (text.at(-1) !== '.' ? '.' : '') + ' ' + aliases;
                    return `    /${key} - ${text}`;
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
            let parsedDate = normalizeParsedDate(now.getTime(), chatSettings.settings.timezone);
            const clientNow = new Date(parsedDate);
            replyText += `\n\nЧас у вас:\n${clientNow}\nЧасова зона/здвиг у вас:\n${chatSettings.settings.timezone}\n`;

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
        if (!await this.ensureAccess(ctx, this.getUserId(ctx), chatId, null, cmdName, chatSettings))
            return false;

        let { error, name, maxPlayers, date, isDateWithoutTime, subgames } = this.parseGameData(ctx, args, chatSettings);
        if (error) return error;

        const creatorId = this.getUserId(ctx);
        const creatorName = extractUserTitle(ctx.from, false);
        const chatName = ctx.chat.title;

        const game = {
            createdById: creatorId,
            createdByName: creatorName,
            status: GameStatus.ACTIVE,
            chatId,
            chatName,
            name,
            date: subgames && subgames.some(item => isDate(item.date)) ? null : date,
            isDateWithoutTime,
            maxPlayers,
            players: [],
            subgames
        };
        console.log(`Now ${new Date()}`);
        console.log(`Converted Date ${game.date}`);
        console.log(`Game ${game.name}`);

        const gameId = await this.database.createGame(game);
        const message = await this.writeGameMessage(ctx, game);
        /*await */this.database.updateGame(gameId, { messageId: message.message_id });

        const replyText = `Ви щойно створили гру "${game.name}" (id=${gameId}).` + (game.isDateWithoutTime ? '\n\n' + this.emoji.warn + 'Для того щоб коректно нагадувати та деактивовувати ігри краще зазначати дату ігри разом з часом.' : '');
        this.replyToUserDirectOrDoNothing(ctx, replyText);
    }

    async handleDelGame(ctx) {
        // Важливо: ця команда може запускатись не з групи а напряму боту, тому айді чата береться з гри
        let [cmdName, ...args] = str2params(ctx.message.text);
        cmdName = cmdName.slice(1);

        if (args.length < 1) return this.replyWarning(ctx, cmdName, 'Не переданий ідентифікатор гри.');

        const gameId = args[0];
        const game = await this.database.getGameWithPlayers(gameId);
        if (!game) return;

        const chatId = game.chatId;
        if (!await this.ensureAccess(ctx, this.getUserId(ctx), chatId, game.createdById, cmdName))
            return false;

        if (game.status !== GameStatus.DELETED) await this.database.deactivateGame(gameId);
        try {
            await this.bot.telegram.deleteMessage(game.chatId, game.messageId);
        } catch (error) {
            console.error(error); // TelegramError: 400: Bad Request: message to edit not found
            //await this.replyToUser(ctx, `Сталася помилка при спробі видалення повідомлення з грою: ${error?.code} - ${error?.description}`);
            try {
                game.status = GameStatus.DELETED;
                await this.updateGameMessage(game);
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
        const game = await this.database.getGameWithPlayers(gameId);
        if (!game) return;

        const chatId = game.chatId;
        if (!await this.ensureAccess(ctx, this.getUserId(ctx), chatId, game.createdById, cmdName))
            return false;

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

        const result = await this._changeGame(ctx, game, supportedParams);
        if (result !== true) return;

        const replyText = `Ви щойно змінили гру "${game.name}" (id=${gameId}).`
        this.replyToUserDirectOrDoNothing(ctx, replyText);
    }

    async _changeGame(ctx, game, supportedParams) {
        const updateData = {};
        for (let key in supportedParams) {
            if (supportedParams[key] === null) {
                continue;
            }
            if (key === 'name') {
                updateData.name = supportedParams[key];
                game.name = updateData.name;
            } else if (key === 'players') {
                updateData.maxPlayers = parseInt(supportedParams[key], 10);
                if (!updateData.maxPlayers || updateData.maxPlayers <= 0) return this.replyToUserDirectOrDoNothing(ctx, this.emoji.warn + 'Кількість ігроків повинно бути числом більше 0.');
                game.maxPlayers = updateData.maxPlayers;
            } else if (key === 'date') {
                let subgame = (game.subgames || []).find(item => isDate(item.date));
                if (subgame) return this.replyToUserDirectOrDoNothing(ctx, this.emoji.warn + 'Не можна змінити дату у гри з підіграми (лігами).');

                const stringDate = supportedParams[key];
                //const parsedDate = this.parseDateByChatSettings(stringDate, chatSettings);
                const chatSettings = await this.database.getChatSettings(game.chatId);
                const parsedDate = parseDate(stringDate, chatSettings.settings.timezone);
                if (!parsedDate) return this.replyToUserDirectOrDoNothing(ctx, this.invalidDateFormatMessage);
                game.date = updateData.date = new Date(parsedDate);
                game.isDateWithoutTime = updateData.isDateWithoutTime = getDigitGroupCount(stringDate) < 4;
                // game.date = updateData.date;
                // game.isDateWithoutTime = updateData.isDateWithoutTime;
            } else if (key === 'active') {
                game.status = updateData.status = isTrue(supportedParams[key]) ? GameStatus.ACTIVE : GameStatus.INACTIVE;
                // game.status = updateData.status;
            }
        }
        const gameId = game._id.toHexString();
        await this.database.updateGame(gameId, updateData);
        /*await*/ this.updateGameMessage(game);
        return true;
    }

    async handleKickFromGame(ctx) {
        // Важливо: ця команда може запускатись не з групи а напряму боту, тому айді чата береться з гри
        let [cmdName, ...args] = str2params(ctx.message.text);
        cmdName = cmdName.slice(1);

        if (args.length < 2) return this.replyWarning(ctx, cmdName, 'Передана недостатня кількість параметрів.');

        const gameId = args.shift();
        const game = await this.database.getGameWithPlayers(gameId);
        if (!game) return;

        const chatId = game.chatId;
        if (!await this.ensureAccess(ctx, this.getUserId(ctx), chatId, game.createdById, cmdName))
            return false;

        let player = args.shift();
        const filtered = game.players.filter(p => String(p.id) === player || p.name === player);
        if (filtered.length === 0) return this.replyToUserDirectOrDoNothing(ctx, this.emoji.warn + `Ігрока "${player}" не було знайдено у грі "${game.name}".`);
        if (filtered[0].status === 'kicked') return this.replyToUserDirectOrDoNothing(ctx, this.emoji.warn + `Ігрок "${player}" вже був виключений з гри "${game.name}".`);
        const setIds = new Set();
        filtered.forEach(p => setIds.add(p.id));
        if (setIds.size > 1) return this.replyToUserDirectOrDoNothing(ctx, this.emoji.warn + `Знайдено різних ігроків за запитом "${player}" у грі "${game.name}". Уточніть дані ігрока.`);
        await this.database.kickUserFromAllGameSlots(game._id, filtered[0].id);
        game.players = await this.database.getGamePlayers(game._id);

        /*await*/ this.updateGameMessage(game);
        return this.replyToUserDirectOrDoNothing(ctx, `Ігрока "${player}" виключено з гри "${game.name}".`);
    }

    async handleActiveGames(ctx) {
        const chatId = this.getChatId(ctx);
        const userId = this.getUserId(ctx);
        const filter = { /*isActive: true*/status: GameStatus.ACTIVE };
        let where = '';
        let showStatusless = false;
        if (this.isGroup(chatId)) {
            filter.chatId = chatId;
            where = ' у ' + ctx.chat.title;
        }
        if (await this.isSuperAdmin(ctx)) {
            // Якщо користувач є супер адміном і він команду з параметром -all, то треба показати взагалі усі ігри, а не тільки ті, для яких користувач лишив свій голос (статус)
            let [_, ...args] = str2params(ctx.message.text);
            showStatusless = (args[0] === '-all');
        }

        const games = await this.database.getActiveGamesWithChatSettings(filter);
        //console.log(games);
        const now = new Date();
        let response = `Немає активних ігор${where}.`;
        if (games.length) {
            const lines = [];
            for (const game of games) {
                let gameDate = game.date;
                let subgame = (game.subgames || []).find(item => isDate(item.date) && (item.date + (item.isDateWithoutTime ? 86_400_000 : 0) > now));
                if (subgame) {
                    gameDate = subgame.date;
                }

                let status = this.isGroup(chatId) ? ' Без статусу' : '';
                let ind = game.players.filter(p => p.status === 'joined').sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).findIndex(p => p.id === userId);
                let limit = game.maxPlayers || Infinity;
                if (ind >= 0 && ind < limit) status = '✅ Йду';
                if (ind >= 0 && ind >= limit) status = '⏳ У черзі';
                if (game.players.some(p => p.id === userId && p.status === 'pending')) status = '❓ Думаю';
                if (game.players.some(p => p.id === userId && p.status === 'declined')) status = '❌ Не йду';
                if (game.players.some(p => p.id === userId && p.status === 'kicked')) status = this.emoji.kick + ' Вас виключено';
                if (status || showStatusless) {
                    //let dateText = game.date ? `${date2text(game.date)}` : '';
                    // let chatSettings = await this.database.getChatSettings(game.chatId);
                    // let timezone = chatSettings?.timezone || this.getDefaultSettings().timezone;
                    let timezone = game.timezone || this.getDefaultSettings().timezone;
                    let dateText = '-';
                    if (gameDate) {
                        dateText = formatToTimeZone(gameDate, timezone);
                        if (game.isDateWithoutTime) dateText = dateText.split(' ')[0];
                    }
                    let extra = showStatusless ? ` у групі ${game.chatName}` : '';
                    lines.push({ gameDate, text: `📅 ${dateText}, ${game.name}${extra} - ${status}` });
                }
            }
            if (lines.length) {
                lines.sort((a, b) => (a.gameDate || 0) - (b.gameDate || 0));
                response = `📋 **Активні ігри${where}:**\n\n` + lines.map(elem => elem.text).join('\n' + '—'.repeat(18) + '\n');
            }
        }
        this.replyToUser(ctx, response);
    }

    async handleSettings(ctx) {
        const chatId = this.getChatId(ctx);
        if (this.isGroup(chatId) && !await this.ensureAccess(ctx, this.getUserId(ctx), chatId, null, 'change_settings'))
            return false;

        const userId = this.getUserId(ctx);
        const settings = await this.database.getSettingsByChatId(chatId);

        const msgText = ctx.message.text;
        let [cmdName, ...args] = str2params(msgText);
        cmdName = cmdName.slice(1);

        const markup = this.getMarkupForSettings(chatId);
        const msg = this.buildTextMessageOfCurrentSettings(settings, chatId, ctx.chat.title);
        try {
            this.sendMessage(userId, msg, markup);
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
            if (this._checkTimeZone(keyValueObj[key], userId) !== true) return;
        } else if (key === 'notificationTerms') {
            if (this._checkNotificationTerms(keyValueObj[key], userId) !== true) return;
        }
        await this.database.updateUser({ ...ctx.from, settings: keyValueObj }, true);
        /*await*/ this.sendMessage(userId, this.emoji.info + `Налаштування ${key} оновлене.`);
    }

    async handleRefreshGameMessage(ctx) {
        let [_, ...args] = parseArgs(ctx.message.text);
        if (args.length != 1) return await this.sendMessage(userId, this.emoji.warn + 'Передана некоректа кількість параметрів.');

        const str = args[0];
        const isHex = /^[0-9a-fA-F]+$/.test(str);
        const filter = {};
        if (isHex) {
            const partialId = str + '$';
            filter.$expr = {
                $regexMatch: {
                    input: { $toString: "$_id" },
                    regex: partialId, // Можна додати '^' на початку, якщо шукаєте лише з старту
                    options: "i"
                }
            }
        } else {
            filter.name = { $regex: str, $options: "i" };
        }
        const games = await this.database.findGames(filter);
        const gamesCount = games.length;
        if (!gamesCount) return this.replyOrDoNothing(ctx, this.emoji.warn + ' Жодної гри не знайдено.');

        if (gamesCount > 1) {
            const showCount = 10;
            const text = games
                .sort((a, b) => {
                    const timeA = a.createdDate ? new Date(a.createdDate).getTime() : 0;
                    const timeB = b.createdDate ? new Date(b.createdDate).getTime() : 0;
                    return timeB - timeA; // Від нових до старих
                })
                .slice(0, showCount)
                .map(game => {
                    let gameDate = game.date;
                    let subgame = (game.subgames || []).find(item => isDate(item.date));
                    if (subgame) {
                        gameDate = subgame.date;
                    }

                    let timezone = game.timezone || this.getDefaultSettings().timezone;
                    let dateText = '-';
                    if (gameDate) {
                        dateText = formatToTimeZone(gameDate, timezone);
                        if (game.isDateWithoutTime) dateText = dateText.split(' ')[0];
                    }
                    return `📅 ${dateText}, ${game.name} у групі ${game.chatName || '-'} (id=${game._id})`;})
                .join('\n' + '—'.repeat(18) + '\n');
            return this.replyOrDoNothing(ctx, this.emoji.warn + ' Знайдено ' + gamesCount + ' ігор.' + (gamesCount > showCount ? '\nВиведено останні 10:' : '') + '\n\n' + text);
        }

        const game = games[0];
        const gameId = game._id.toHexString();
        game.players = await this.database.getGamePlayers(gameId);
        this.updateGameMessage(game, gameId);
        return this.replyOrDoNothing(ctx, this.emoji.info + ' Оновлено повідомлення для гри ' + game.name + '.');
    }

    subgameDateMs(subgame) {
        const d = subgame?.date;
        if (!d) return null;
        const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
        return Number.isNaN(t) ? null : t;
    }

    hasAnySubgameWithDate(game) {
        return !!(game.subgames?.some(sg => this.subgameDateMs(sg) != null));
    }

    /** Для підігри з часом: кінець інтервалу з діапазону в назві (extractTimeRangeFromText) або +2 год за замовчуванням; для дати без часу — увесь календарний день у timezone чату. */
    getSubgameIntervalBounds(subgame, timeZone) {
        const ms = this.subgameDateMs(subgame);
        if (ms == null) return null;
        const instant = Temporal.Instant.fromEpochMilliseconds(ms);
        const zdt = instant.toZonedDateTimeISO(timeZone);
        if (subgame.isDateWithoutTime) {
            const plainDate = zdt.toPlainDate();
            const dayStart = plainDate.toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from('00:00') });
            const nextDayStart = plainDate.add({ days: 1 }).toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from('00:00') });
            return { start: dayStart.toInstant().epochMilliseconds, end: nextDayStart.toInstant().epochMilliseconds - 1 };
        }
        const plainDate = zdt.toPlainDate();
        const range = extractTimeRangeFromText(subgame.name || '');
        const defaultHours = 2;
        let endZdt;
        if (range?.start && range.end) {
            try {
                const endPt = Temporal.PlainTime.from(range.end);
                const startPt = Temporal.PlainTime.from(range.start);
                if (Temporal.PlainTime.compare(endPt, startPt) > 0) {
                    endZdt = plainDate.toZonedDateTime({ timeZone, plainTime: endPt });
                } else {
                    endZdt = zdt.add({ hours: defaultHours });
                }
            } catch {
                endZdt = zdt.add({ hours: defaultHours });
            }
        } else {
            endZdt = zdt.add({ hours: defaultHours });
        }
        return { start: zdt.toInstant().epochMilliseconds, end: endZdt.toInstant().epochMilliseconds };
    }

    intervalsOverlap(a, b) {
        return a.start < b.end && b.start < a.end;
    }

    subgameIntervalsOverlap(game, chatSettings, idxA, idxB) {
        const tz = chatSettings?.settings?.timezone || this.getDefaultSettings().timezone;
        const sgA = game.subgames[idxA];
        const sgB = game.subgames[idxB];
        if (!sgA || !sgB) return false;
        const bA = this.getSubgameIntervalBounds(sgA, tz);
        const bB = this.getSubgameIntervalBounds(sgB, tz);
        if (!bA || !bB) return true;
        return this.intervalsOverlap(bA, bB);
    }

    findBlockingOtherSubgameSignup(game, chatSettings, userId, targetSubIdx, newStatus) {
        if (!game.subgames || game.subgames.length <= 1) return null;
        const hasSchedule = this.hasAnySubgameWithDate(game);
        const statusBlocks = (s) => s === 'joined' || s === 'pending';

        for (const p of game.players) {
            if (p.id !== userId || p.extraPlayer) continue;
            if (p.subgameIndex === targetSubIdx) continue;

            if (!hasSchedule) {
                if (newStatus === 'joined' && p.status === 'joined') {
                    return { message: this.emoji.warn + 'Ви вже йдете на гру ' + game.subgames[p.subgameIndex]?.name + '.' };
                }
                continue;
            }

            if (!statusBlocks(newStatus) || !statusBlocks(p.status)) continue;

            const tMs = this.subgameDateMs(game.subgames[targetSubIdx]);
            const oMs = this.subgameDateMs(game.subgames[p.subgameIndex]);
            const otherName = game.subgames[p.subgameIndex]?.name || '';

            if (tMs == null || oMs == null) {
                return { message: this.emoji.warn + 'Ви вже відмітили статус у підігрі «' + otherName + '».' };
            }

            if (this.subgameIntervalsOverlap(game, chatSettings, targetSubIdx, p.subgameIndex)) {
                return { message: this.emoji.warn + 'Час цієї підігри перетинається з «' + otherName + '».' };
            }
        }
        return null;
    }

    checkSubgameSignupConflict(game, chatSettings, userId, subgameIndexStr, newStatus) {
        if (!subgameIndexStr) return null;
        const hasSchedule = this.hasAnySubgameWithDate(game);
        if (newStatus !== 'joined' && !(hasSchedule && newStatus === 'pending')) return null;
        return this.findBlockingOtherSubgameSignup(game, chatSettings, userId, +subgameIndexStr, newStatus)?.message ?? null;
    }

    /** Найбільший номер додаткового гравця (+1) для цього користувача в межах підігри. */
    maxExtraPlayerForUser(game, userId, subgameIndex) {
        let max = 0;
        for (const p of game.players || []) {
            if (p.id !== userId || !p.extraPlayer) continue;
            if (!(!subgameIndex || p.subgameIndex === +subgameIndex)) continue;
            max = Math.max(max, p.extraPlayer);
        }
        return max;
    }

    async updateGameStatus(ctx, action) {
        const [fullGameId, extraAction] = ctx.match[1].split('_');
        const [gameId, subgameIndex] = fullGameId.split('/');
        const userId = this.getUserId(ctx);
        const username = extractUserTitle(ctx.from);
        const fullName = extractUserTitle(ctx.from, false);
        const timestamp = new Date();

        const game = await this.database.getGameWithPlayers(gameId);
        if (!game) return this.showPopup(ctx, this.emoji.notfound + 'Гру не знайдено.');
        if (/*!game.isActive*/game.status !== GameStatus.ACTIVE) return this.showPopup(ctx, this.emoji.warn + 'Гра неактивна.');

        const chatSettings = await this.database.getChatSettings(game.chatId);
        if (!chatSettings || (chatSettings.botStatus && chatSettings.botStatus !== 'member')) return console.error(`Важливо (updateGameStatus): бот не є членом групи ${chatSettings.chatName} (id=${game.chatId})`);

        const newStatus = getStatusByAction(action);
        const subgameIndexNum = parseInt(subgameIndex, 10) || 0;
        const gid = game._id;
        let playerInd = game.players.findIndex(p => p.id === userId && !p.extraPlayer && (!subgameIndex || p.subgameIndex === +subgameIndex));
        if (playerInd >= 0 && game.players[playerInd].status === 'kicked') {
            return this.showPopup(ctx, this.emoji.kick + 'Вас виключено з гри.');
        }
        if (extraAction && (playerInd == -1 || game.players[playerInd].status !== 'joined')) {
            if (!chatSettings.settings?.allowVotePlusWithoutMainPlayers) {
                return this.showPopup(ctx, this.emoji.warn + 'Спершу натисніть що ви самі йдете на гру.');
            }
        }
        let extraPlayer = this.maxExtraPlayerForUser(game, userId, subgameIndex);
        if (extraAction) {
            if (extraAction === 'minus') {
                if (extraPlayer <= 0) {
                    return this.showPopup(ctx, this.emoji.warn + 'Немає додаткових ігроків, яких ви залучили.');
                }
                playerInd = game.players.findIndex(p => p.id === userId && p.extraPlayer === extraPlayer && (!subgameIndex || p.subgameIndex === +subgameIndex));
                if (playerInd < 0) {
                    return this.showPopup(ctx, this.emoji.warn + 'Запис не знайдено.');
                }
                await this.database.deleteGamePlayerSlot(gid, game.players[playerInd]);
            } else {
                extraPlayer++;
                const inserted = await this.database.insertGamePlayer(gid, {
                    id: userId,
                    name: username,
                    fullName: fullName,
                    extraPlayer,
                    status: newStatus,
                    timestamp,
                    subgameIndex: subgameIndexNum
                });
                if (!inserted.ok) {
                    if (inserted.duplicate) {
                        game.players = await this.database.getGamePlayers(gid);
                        this.updateGameMessage(game);
                        return this.showPopup(ctx, '');
                    }
                    return this.showPopup(ctx, this.emoji.err + 'Не вдалося додати ігрока.');
                }
            }
        } else {
            if (playerInd >= 0) {
                if (game.players[playerInd].status === newStatus) {
                    return;
                }
                if (extraPlayer > 0) {
                    return this.showPopup(ctx, this.emoji.warn + 'Перед тим як змінювати свій статус видмініть похід на гру для додаткових ігроків, яких ви залучили.');
                } else {
                    const conflict = this.checkSubgameSignupConflict(game, chatSettings, userId, subgameIndex, newStatus);
                    if (conflict) return this.showPopup(ctx, conflict);
                }
                const slot = game.players[playerInd];
                await this.database.updateGamePlayerSlot(gid, slot, {
                    status: newStatus,
                    timestamp,
                    name: username,
                    fullName: fullName
                });
            } else {
                const conflict = this.checkSubgameSignupConflict(game, chatSettings, userId, subgameIndex, newStatus);
                if (conflict) return this.showPopup(ctx, conflict);
                const inserted = await this.database.insertGamePlayer(gid, {
                    id: userId,
                    name: username,
                    fullName: fullName,
                    extraPlayer: 0,
                    status: newStatus,
                    timestamp,
                    subgameIndex: subgameIndexNum
                });
                if (!inserted.ok && inserted.duplicate) {
                    game.players = await this.database.getGamePlayers(gid);
                    playerInd = game.players.findIndex(p => p.id === userId && !p.extraPlayer && (!subgameIndex || p.subgameIndex === +subgameIndex));
                    if (playerInd >= 0 && game.players[playerInd].status === newStatus) {
                        this.updateGameMessage(game);
                        return this.showPopup(ctx, '');
                    }
                    return this.showPopup(ctx, this.emoji.warn + 'Ваш запис уже оновлено. Оновіть повідомлення гри.');
                }
                if (!inserted.ok) return this.showPopup(ctx, this.emoji.err + 'Не вдалося записати на гру.');
            }
        }

        game.players = await this.database.getGamePlayers(gid);

        this.updateGameMessage(game);
        this.showPopup(ctx, '');
    }

    async handleGameActivation(ctx) {
        const game = await this._getAndCheckGameForActivation(ctx);
        if (!game?._id) return;

        const status = game.status === GameStatus.ACTIVE ? GameStatus.INACTIVE : GameStatus.ACTIVE;
        this._setGameStatus(game, status);
        this.showPopup(ctx, this.emoji.info + 'Гру ' + (status === GameStatus.ACTIVE ? 'відкрито.' : 'закрито.'));
    }

    async handleGameOpening(ctx) {
        const game = await this._getAndCheckGameForActivation(ctx);
        if (!game?._id) return false;
        if (game.status === GameStatus.ACTIVE) return this.showPopup(ctx, this.emoji.info + 'Гра вже відкрита.');

        this._setGameStatus(game, GameStatus.ACTIVE);
        this.showPopup(ctx, this.emoji.info + 'Гру відкрито.');
    }

    async handleGameClosing(ctx) {
        const game = await this._getAndCheckGameForActivation(ctx);
        if (!game?._id) return false;
        if (game.status === GameStatus.INACTIVE) return this.showPopup(ctx, this.emoji.info + 'Гра вже закрита.');

        this._setGameStatus(game, GameStatus.INACTIVE);
        this.showPopup(ctx, this.emoji.info + 'Гру закрито.');
    }

    async _getAndCheckGameForActivation(ctx) {
        const cmdName = 'change_game';
        const gameId = ctx.match[1].split('_')[0];

        const game = await this.database.getGameWithPlayers(gameId);
        if (!game) return this.showPopup(ctx, this.emoji.notfound + 'Гру не знайдено.');
        if (game.status === GameStatus.EXPIRED) return this.showPopup(ctx, this.emoji.warn + 'Гра вже закінчена.');

        const chatId = game.chatId;
        if (!await this.ensureAccess(ctx, this.getUserId(ctx), chatId, game.createdById, cmdName))
            return false;

        return game;
    }

    async _setGameStatus(game, status) {
        const gameId = game._id.toHexString();
        //console.log(gameId);

        const updateData = {};
        updateData.status = status;
        game.status = updateData.status;

        await this.database.updateGame(gameId, updateData);
        await this.updateGameMessage(game);

        //const replyText = `Ви щойно змінили гру "${game.name}" (id=${gameId}).`
        //this.replyToUserDirectOrDoNothing(ctx, replyText);
        //this.showPopup(ctx, this.emoji.info + 'Гру ' + (/*game.isActive*/game.status === GameStatus.ACTIVE ? 'відкрито.' : 'закрито.'));
    }

    async handleGameChanging(ctx, key) {
        const game = await this._getAndCheckGameForActivation(ctx);
        if (!game?._id) return false;

        const gameId = ctx.match[1];
        this.waitingInput[ctx.from.id] = { type: key, gameId };
        if (key === 'players')
            ctx.reply('Введіть нову кількість гравців (>0):');
        else if (key === 'date')
            ctx.reply('Введіть нову дату та час (YYYY-MM-DD HH:mm або YYYY-MM-DD):');
        else if (key === 'name')
            ctx.reply('Введіть нову назву гри:');
    }

    async handleGameSetup(ctx) {
        const cmdName = 'change_game';
        const gameId = ctx.match[1].split('_')[0];

        const game = await this.database.getGameWithPlayers(gameId);
        if (!game) return this.showPopup(ctx, this.emoji.notfound + 'Гру не знайдено.');

        const chatId = game.chatId;
        if (!await this.ensureAccess(ctx, this.getUserId(ctx), chatId, game.createdById, cmdName))
            return false;

        const userId = this.getUserId(ctx);
        const user = await this.database.getUser(userId);
        if (!user || !user.started) return this.showPopup(ctx, this.emoji.warn + ' Для налаштування гри слід перейти до бота на натиснути кнопку Start.');

        // this.showPopup(ctx, this.emoji.info + ' Даний функціонал у розробці. Слідкуйте за оновленнями.');
        const markup = Markup.inlineKeyboard([
            [
                Markup.button.callback('⏸️ Закрити игру', `disactivate_${gameId}`),
                Markup.button.callback('▶️ Відкрити гру', `activate_${gameId}`)
            ],
            [
                Markup.button.callback(this.emoji.edit + ' К-ть гравців', `edit_game_maxPlayers_${gameId}`),
                Markup.button.callback(this.emoji.edit + ' Дату, час', `edit_game_date_${gameId}`)
            ],
            [
                Markup.button.callback(this.emoji.edit + ' Назву', `edit_game_name_${gameId}`)/*,
                Markup.button.callback(this.emoji.edit + ' Нагадування', `editNotif_${gameId}`)*/
            ]
        ]);
        this.replyToUserDirectOrDoNothing(ctx, `Гра: ${truncateString(game.name, 150)}`, markup);
    }

    async handleShowSettings(ctx) {
        const cmdName = 'change_settings';
        const chatId = +(ctx.match[1].split('_')[0]);
        if (this.isGroup(chatId) && !await this.ensureAccess(ctx, this.getUserId(ctx), chatId, null, cmdName)) {
            // для груп треба перевірити права на цю команду
            return false;
        }

        const buttons = [
            [Markup.button.callback(this.emoji.edit + ' Часову зону', `edit_settings_tz_${chatId}`)],
            [Markup.button.callback(this.emoji.edit + ' Інтервал нагадувань', `edit_settings_notif_${chatId}`)]
        ];
        if (this.isGroup(chatId))
            buttons.push([Markup.button.callback(this.emoji.edit + ' Дозволити "+" якщо сам ігрок не йде', `edit_settings_allowVotePlusWO_${chatId}`)]);
        buttons.push([Markup.button.callback('🔙 Назад', `back_to_settings_${chatId}`)]);
        /*await*/ ctx.editMessageReplyMarkup(
            Markup.inlineKeyboard(buttons).reply_markup
        );
    }

    async handleBackToShowSettings(ctx) {
        const chatId = ctx.match[1].split('_')[0];

        const markup = this.getMarkupForSettings(chatId); // Markup.inlineKeyboard([Markup.button.callback(this.emoji.setup + ' Змінити налаштування', `settings_${chatId}`)]);
        await ctx.editMessageReplyMarkup(
            markup.reply_markup
        );
    }

    async handleSettingsChanging(ctx, mode) {
        const chatId = ctx.match[1];
        this.showPopup(ctx, '');

        if (mode === 'tz') {
            await ctx.editMessageReplyMarkup(Markup.inlineKeyboard([
                [Markup.button.callback('Europe/Kyiv', `set_settings_tz_Europe/Kyiv_${chatId}`)],
                [Markup.button.callback('Europe/Warsaw', `set_settings_tz_Europe/Warsaw_${chatId}`)],
                [Markup.button.callback('Europe/Madrid', `set_settings_tz_Europe/Madrid_${chatId}`)],
                [Markup.button.callback('Ввести вручну', `set_settings_tz_manual_${chatId}`)],
                [Markup.button.callback('🔙 До налаштувань', `back_to_settings_${chatId}`)]
            ]).reply_markup);
        } else if (mode === 'notif') {
            await ctx.editMessageReplyMarkup(Markup.inlineKeyboard([
                [Markup.button.callback('Не нагадувати', `set_settings_notif__${chatId}`)],
                [Markup.button.callback('За день, за 2 години', `set_settings_notif_-1440,-120_${chatId}`)],
                [Markup.button.callback('За день, за 1 годину', `set_settings_notif_-1440,-60_${chatId}`)],
                [Markup.button.callback('За 2 години', `set_settings_notif_-120_${chatId}`)],
                [Markup.button.callback('За 1 годину', `set_settings_notif_-60_${chatId}`)],
                [Markup.button.callback('Ввести вручну', `set_settings_notif_manual_${chatId}`)],
                [Markup.button.callback('🔙 До налаштувань', `back_to_settings_${chatId}`)]
            ]).reply_markup);
        } else if (mode === 'allowVotePlusWO') {
            await ctx.editMessageReplyMarkup(Markup.inlineKeyboard([
                [Markup.button.callback('Ні', `set_settings_allowVotePlusWO_0_${chatId}`)],
                [Markup.button.callback('Так', `set_settings_allowVotePlusWO_1_${chatId}`)],
                [Markup.button.callback('🔙 До налаштувань', `back_to_settings_${chatId}`)]
            ]).reply_markup);
        }
    }

    async handleSettingsSetTimeZone(ctx, messageId) {
        if (!messageId) {
            messageId = ctx.update.callback_query.message.message_id;
            this.currentMarkup[messageId] = ctx.update.callback_query.message.reply_markup;
        }

        const key = 'timezone';
        let [value, chatId] = ctx.match[1].split('_');
        chatId = +chatId;
        if (this.isGroup(chatId) && !await this.ensureAccess(ctx, this.getUserId(ctx), chatId, null, 'change_settings'))
            return false;

        if (value === 'manual') {
            this.waitingInput[ctx.from.id] = { type: key, chatId, messageId };
            ctx.reply('Введіть часову зону:', { reply_to_message_id: messageId });
            return;
        }

        const userId = this.getUserId(ctx);
        if (this._checkTimeZone(value, userId) !== true) return;

        const settings = await this.database.getSettingsByChatId(chatId);
        settings[key] = value;
        let chatName;
        if (this.isGroup(chatId)) {
            await this.database.updateChatSettings({ chatId, settings });
            chatName = (await this.database.getChatSettings(chatId) || {}).chatName;
        } else {
            await this.database.updateUser({ id: userId, settings }, true);
        }

        // delete(this.currentMarkup[messageId]);

        const msg = this.emoji.info + ' Налаштування змінено.';
        if (ctx.callbackQuery) this.showPopup(ctx, msg);
        else this.replyToUserDirectOrDoNothing(ctx, msg);

        const _chatId = ctx.update?.callback_query?.message?.chat?.id || this.getChatId(ctx);
        this.updateSetingsMessage(_chatId, messageId, settings, chatId, chatName);
    }

    async handleSettingsSetNotificationTerms(ctx, messageId) {
        if (!messageId) {
            messageId = ctx.update.callback_query.message.message_id;
            this.currentMarkup[messageId] = ctx.update.callback_query.message.reply_markup;
        }

        const key = 'notificationTerms';
        let [value, chatId] = ctx.match[1].split('_');
        chatId = +chatId;
        if (this.isGroup(chatId) && !await this.ensureAccess(ctx, this.getUserId(ctx), chatId, null, 'change_settings'))
            return false;

        if (value === 'manual') {
            const messageId = ctx.update.callback_query.message.message_id;
            this.waitingInput[ctx.from.id] = { type: key, chatId, messageId: messageId };
            ctx.reply('Введіть за скільки хвилин треба надсилати нагадування (якщо декілька, то через кому):', { reply_to_message_id: messageId });
            return;
        }

        const userId = this.getUserId(ctx);
        if (this._checkNotificationTerms(value, userId) !== true) return;

        const settings = await this.database.getSettingsByChatId(chatId);
        settings[key] = value;
        let chatName;
        if (this.isGroup(chatId)) {
            await this.database.updateChatSettings({ chatId, settings });
            chatName = (await this.database.getChatSettings(chatId) || {}).chatName;
        } else {
            await this.database.updateUser({ id: userId, settings }, true);
        }

        // delete(this.currentMarkup[messageId]);

        const msg = this.emoji.info + ' Налаштування змінено.';
        if (ctx.callbackQuery) this.showPopup(ctx, msg);
        else this.replyToUserDirectOrDoNothing(ctx, msg);

        const _chatId = ctx.update?.callback_query?.message?.chat?.id || this.getChatId(ctx);
        this.updateSetingsMessage(_chatId, messageId, settings, chatId, chatName);
    }

    async handleSettingsSetAllowVotePlusWO(ctx) {
        const messageId = ctx.update.callback_query.message.message_id;
        this.currentMarkup[messageId] = ctx.update.callback_query.message.reply_markup;

        const key = 'allowVotePlusWithoutMainPlayers';
        let [value, chatId] = ctx.match[1].split('_');
        chatId = +chatId;
        if (this.isGroup(chatId) && !await this.ensureAccess(ctx, this.getUserId(ctx), chatId, null, 'change_settings'))
            return false;

        value = !!(+value);

        const userId = this.getUserId(ctx);
        // if (this._checkNotificationTerms(value, userId) !== true) return;

        const settings = await this.database.getSettingsByChatId(chatId);
        settings[key] = value;
        let chatName;
        if (this.isGroup(chatId)) {
            await this.database.updateChatSettings({ chatId, settings });
            chatName = (await this.database.getChatSettings(chatId) || {}).chatName;
        } else {
            await this.database.updateUser({ id: userId, settings }, true);
        }

        // delete(this.currentMarkup[messageId]);

        const msg = this.emoji.info + ' Налаштування змінено.';
        if (ctx.callbackQuery) this.showPopup(ctx, msg);
        else this.replyToUserDirectOrDoNothing(ctx, msg);

        const _chatId = ctx.update?.callback_query?.message?.chat?.id || this.getChatId(ctx);
        this.updateSetingsMessage(_chatId, messageId, settings, chatId, chatName);
    }

    async handleGameNotification(ctx) {
        const gameId = ctx.match[1].split('_')[0];

        const game = await this.database.getGameWithPlayers(gameId);
        if (!game) return this.showPopup(ctx, this.emoji.notfound + ' Гру не знайдено.');

        let gameDate = game.date;
        let isDateWithoutTime = game.isDateWithoutTime;
        let subgame = (game.subgames || []).find(item => isDate(item.date));
        if (subgame) {
            gameDate = subgame.date;
            isDateWithoutTime = subgame.isDateWithoutTime;
        }
        if (isDateWithoutTime || !gameDate) return this.showPopup(ctx, this.emoji.warn + ' Нагадування можливі лише для ігр з вказаною датою та часом.');

        const userId = this.getUserId(ctx);
        if (!game.players.some(p => p.status === 'joined' && p.id === userId)) return this.showPopup(ctx, this.emoji.warn + ' Спершу натисніть що йдете на гру.');

        const user = await this.database.getUser(userId);
        if (!user || !user.started) return this.showPopup(ctx, this.emoji.warn + ' Для отримання сповіщень від бота слід перейти до нього на натиснути кнопку Start.');

        if (user.settings?.notificationTerms) return this.showPopup(ctx, this.emoji.warn + ' У вас вже є в налаштуваннях встановлені періоди нагадувань: ' + user.settings?.notificationTerms.split(',').map(v => `за ${-v} хв`).join(', ') + '.');

        const notification = await this.database.createNotification(gameId, userId);
        if (!notification) return this.showPopup(ctx, this.emoji.err + 'Помилка при створені нагадування. Зверніться до розробника.');
        if (!notification.isActive) return this.showPopup(ctx, this.emoji.notif + 'Нагадування про гру видалено. Не запізнюйтесь на гру.');
        this.showPopup(ctx, this.emoji.notif + 'Нагадаю вам про гру за 1 годину. Набирайтесь сил.');
    }

    buildTextMessage(game, chatSettings) {
        const players = game.players || [];
        const m = (user) => {
            const extra = (user.extraPlayer ? ' (+)' : '');
            return `[${truncateString(user.fullName || user.name, 28)}${extra}](tg://user?id=${user.id})`;
        };
        const limit = game.maxPlayers || Infinity;
        //const dateText = game.date ? ` (${date2text(game.date)})` : '';
        let gameDate = game.date;
        //let chatSettings = await this.database.getChatSettings(game.chatId);
        let timezone = chatSettings?.settings?.timezone || this.getDefaultSettings().timezone;
        let dateText = '';
        if (gameDate) {
            dateText = formatToTimeZone(gameDate, timezone);
            //if (game.isDateWithoutTime)
                dateText = ` (${dateText.split(' ')[0]})`;
        }
        let gameText = '';
        let sectionSeparator = unescapeString(chatSettings?.settings?.sectionSeparator || '');
        if (game.subgames && game.subgames.length > 1) {
            for (let ind = 0, n = game.subgames.length; ind < n; ind++) {
                let subgame = game.subgames[ind];
                let separator = (ind === n - 1 ? '' : '—'.repeat(18)) + '\n';
                gameText +=
                `🏆 ${subgame.name}\n` +
                `👥 Кількість учасників ${players.filter(p => p.status === 'joined' && p.subgameIndex === ind).length}${subgame.maxPlayers ? '/' + subgame.maxPlayers : ''}\n` +
                `${sectionSeparator}✅ Йдуть: ${players.filter(p => p.status === 'joined' && p.subgameIndex === ind).slice(0, limit).map(p => `\n✅ ${m(p)}`).join(', ') || '-'}\n` +
                `${sectionSeparator}⏳ У черзі: ${players.filter(p => p.status === 'joined' && p.subgameIndex === ind).slice(limit).map(p => `\n⏳ ${m(p)}`).join(', ') || '-'}\n` +
                `${sectionSeparator}❓ Думають: ${players.filter(p => p.status === 'pending' && p.subgameIndex === ind).map(p => `\n❓ ${m(p)}`).join(', ') || '-'}\n` +
                `${sectionSeparator}❌ Не йдуть: ${players.filter(p => p.status === 'declined' && p.subgameIndex === ind).map(p => `\n❌ ${m(p)}`).join(', ') || '-'}\n${separator}`;
            }
        } else {
            gameText += `👥 Кількість учасників ${players.filter(p => p.status === 'joined').length}${game.maxPlayers ? '/' + game.maxPlayers : ''}\n` +
            `${sectionSeparator}✅ Йдуть: ${players.filter(p => p.status === 'joined').slice(0, limit).map(p => `\n✅ ${m(p)}`).join(', ') || '-'}\n` +
            `${sectionSeparator}⏳ У черзі: ${players.filter(p => p.status === 'joined').slice(limit).map(p => `\n⏳ ${m(p)}`).join(', ') || '-'}\n` +
            `${sectionSeparator}❓ Думають: ${players.filter(p => p.status === 'pending').map(p => `\n❓ ${m(p)}`).join(', ') || '-'}\n` +
            `${sectionSeparator}❌ Не йдуть: ${players.filter(p => p.status === 'declined').map(p => `\n❌ ${m(p)}`).join(', ') || '-'}\n\n`;
        }
        let topText = ''
        if (game.status === GameStatus.INACTIVE) topText = '‼️ ГРА НЕАКТИВНА ‼️\n\n';
        else if (game.status === GameStatus.EXPIRED) topText = '‼️ ГРА ЗАКІНЧИЛАСЬ ‼️\n\n';
        else if (game.status === GameStatus.DELETED) topText = '‼️ ГРА ВИДАЛЕНА ‼️\n\n';
        return textMarkdownNormalize(
            topText +
            `📅 ${game.name}${dateText}\n\n` + gameText
        ) + `✍️ _Опубліковано ${game.createdByName}_`;
    }

    buildMarkup(game) {
        if (!game || ![GameStatus.ACTIVE, GameStatus.INACTIVE].includes(game.status)) return null;

        const gameId = game._id.toHexString();
        const buttons = [];
        buttons.push([
            Markup.button.callback(/*game.isActive*/game.status === GameStatus.ACTIVE ? '⏸️ Закрити' : '▶️ Відкрити гру', `activation_${gameId}`),
            ...(/*game.isActive*/game.status === GameStatus.ACTIVE ? [
                Markup.button.callback(this.emoji.notif + 'За 1 год.', `notification_${gameId}`),
                Markup.button.callback(this.emoji.setup, `setup_${gameId}`)
            ] : []),
        ]);
        if (/*!game.isActive*/game.status !== GameStatus.ACTIVE) return Markup.inlineKeyboard(buttons);

        if (!game.subgames || game.subgames.length <= 1) {
            buttons.push([
                Markup.button.callback('✅ Йду', `join_${gameId}`),
                Markup.button.callback('❓ Думаю', `pending_${gameId}`),
                Markup.button.callback('❌ Не йду', `decline_${gameId}`)
            ]);
            buttons.push([
                Markup.button.callback('✅ +1', `join_${gameId}_plus`),
                Markup.button.callback('❌ -1', `decline_${gameId}_minus`)
            ]);
            return Markup.inlineKeyboard(buttons);
        }

        // Підтримка ліг, або підігр
        for (let ind = 0; ind < game.subgames.length; ind ++) {
            let subgame = game.subgames[ind];
            buttons.push([Markup.button.callback(`👇👇 ${subgame.name} 👇👇`, 'none')]);
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

    getGameMessageOptions(game) {
        // Базові опції повідомлення
        const options = {
            parse_mode: 'Markdown',
            link_preview_options: { is_disabled: true }
        };

        // Додаємо розмітку (кнопки) тільки якщо гра активна
        //if (game.isActive) {
            const markup = this.buildMarkup(game);
            Object.assign(options, markup);
        //}

        return options;
    }

    async updateGameMessage(game) {
        if (!game) return;

        const chatSettings = await this.database.getChatSettings(game.chatId);
        if (!chatSettings || (chatSettings.botStatus && chatSettings.botStatus !== 'member'))  return console.error(`Важливо (updateGameMessage): бот не є членом групи ${chatSettings.chatName} (id=${game.chatId})`);

        try {
            return await this.bot.telegram.editMessageText(
                game.chatId,
                game.messageId,
                null,
                this.buildTextMessage(game, chatSettings),
                this.getGameMessageOptions(game)
            );
        } catch (error) {
            const desc = error?.response?.description || error?.description || '';
            if (error?.response?.error_code === 400 && desc.includes('message is not modified')) {
                return;
            }
            console.error(error);
        }
    }

    async writeGameMessage(ctx, game) {
        if (!game) return;

        const chatSettings = await this.database.getChatSettings(game.chatId);
        return await this.replyOrDoNothing(
            ctx,
            this.buildTextMessage(game, chatSettings),
            this.getGameMessageOptions(game)
        );
    }

    get invalidDateFormatMessage() {
        return this.emoji.warn + 'Дату треба вказувати у такому форматі: 2025-03-25 або "2025-03-25 11:00"';
    }

    parseDateByChatSettings(stringDate, chatSettings = {}) {
        if (chatSettings.settings.timezone) {
            const isoString = stringDate.replace(/\./g, '-').replace(' ', 'T').replace(/T(\d):/, "T0$1:"); // T9:00 -> T09:00
            return Temporal.ZonedDateTime.from(`${isoString}[${chatSettings.settings.timezone}]`).toInstant().toString();
        }
        return parseDate(stringDate, chatSettings.settings.timezone);
    }

    async getOrCreateChatSettings(ctx, chatId) {
        let chatSettings = await this.database.getChatSettings(chatId);
        // console.log('getOrCreateChatSettings', chatId, chatSettings);
        if (!chatSettings && this.isGroup(chatId)) {
            chatSettings = await this.makeChatSettings(chatId, ctx);
            await this.database.createChatSettings(chatSettings);
        }
        return chatSettings;
    }

    async ensureAccess(ctx, userId, chatId, createdById, cmdName, chatSettings = null) {
        if (await this.isSuperAdmin(userId)) return true;

        if (!chatSettings) chatSettings = {};
        Object.assign(chatSettings, await this.getOrCreateChatSettings(ctx, chatId));

        const defaults = this.getDefaultPermissions(chatSettings.license);
        chatSettings.permissions = chatSettings.permissions || [];
        const missingPermissions = defaults.filter(defaultItem =>
            !chatSettings.permissions.some(item => item.command === defaultItem.command)
        );
        chatSettings.permissions.push(...missingPermissions);

        return await this.ensureCommandAccess(ctx, chatSettings, cmdName, userId, createdById);
    }

    async ensureCommandAccess(ctx, chatSettings, cmdName, userId, createdById, valueIfNoFoundCommand = true) {
        if (!(await this.hasSuitedLicense(chatSettings, cmdName))) {
            // await this.replyToUserDirectOrDoNothing(ctx, this.emoji.noaccess + 'Недостатня ліцензія на використання цієї команди.');
            let msg = this.emoji.noaccess + 'Недостатня ліцензія на використання цієї команди.';
            if (ctx.callbackQuery) this.showPopup(ctx, msg);
            else this.replyToUserDirectOrDoNothing(ctx, msg);
            return false;
        }

        if (!this.hasPermission(chatSettings, cmdName, userId, createdById, valueIfNoFoundCommand)) {
            // await this.replyToUserDirectOrDoNothing(ctx, this.emoji.noaccess + 'У вас немає повноважень на використання цієї команди.');
            let msg = this.emoji.noaccess + 'Недостатньо прав на використання цієї команди.';
            if (ctx.callbackQuery) this.showPopup(ctx, msg);
            else this.replyToUserDirectOrDoNothing(ctx, msg);
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

    async replyToUserDirectOrDoNothing(ctx, message, options = {}) {
        const userId = this.getUserId(ctx);
        const user = await this.database.getUser(userId);
        let sent = false;
        try {
            await this.bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown', ...options });
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
            await sleep(100);
        }

        return responses; // Повертаємо масив відповідей від API
    }

    showPopup(ctx, msg, isAlert = false) {
        ctx.answerCbQuery(msg, {
            show_alert: msg.length > 50 || !!isAlert
        });
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

    getDefaultSettings(isGroup = true) {
        return {
            ...(!!isGroup ? { license: this.config.licenseClientDefault || 'free' } : {}),
            timezone: this.config.timezoneClientDefault,
            notificationTerms: this.config.notificationTerms || '-1440,-60',
            ...(!!isGroup ? { allowVotePlusWithoutMainPlayers: false } : {})
        };
    }

    getDefaultPermissions(license) {
        return [
            { command: 'add_game', appliesTo: 'all' },
            { command: 'del_game', appliesTo: 'admins,author' },
            { command: 'change_game', appliesTo: 'admins,author' },
            { command: 'kick', appliesTo: 'admins,author' },
            { command: 'change_settings', appliesTo: 'admins' }
        ];
    }

    async makeChatSettings(chatId, ctx) {
        const config = this.getDefaultSettings();
        const chatSettings = {
            chatId,
            chatName: ctx.chat.title,
            // allMembersAreAdministrators: ctx.chat.all_members_are_administrators,
            license: config.license,
            botStatus: 'unknown',
            reminders: [],
            admins: await this.getChatAdmins(chatId), // [],
            permissions: this.getDefaultPermissions(config.license),
            features: [],
            settings: {
                timezone: config.timezone,
                notificationTerms: config.notificationTerms,
                allowVotePlusWithoutMainPlayers: config.allowVotePlusWithoutMainPlayers
            }
        }
        // if (!chatSettings.allMembersAreAdministrators) {
            const admins = this.isGroup(chatId) && await this.bot.telegram.getChatAdministrators(chatId);
            if (admins && admins.length) {
                chatSettings.admins = admins.map(adm => {
                    return {
                        id: adm.user.id,
                        name: extractUserTitle(adm.user)
                    }
                });
            }
        // }
        return chatSettings;
    }

    async hasSuitedLicense(chatSettings, cmdName) {
        const license = (await this.database.getLicenses()).find(elem => elem.type === chatSettings.license);
        if (!license) return false;
        const cmdNames = this.getCmdsByName(cmdName);
        return !!license.commands.find(elem => cmdNames.includes(elem));
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
            const fnMakeChatSettings = needToSetDefaultSettings ? async () => await this.makeChatSettings(chatId, ctx) : null;
            // console.log('updateChatStatus', chatId, status, needToSetDefaultSettings, fnMakeChatSettings);
            this.database.updateChatSettings({ chatId, botStatus: status }, fnMakeChatSettings);
            if (needToSetDefaultSettings) this.replyOrDoNothing(ctx, 'Привіт!\nДякую за додавання мене до групи.\n\nЩоб дізнатися що я вмію відправьте команду /help.');
        } else {
            const started = status === 'member';
            this.database.updateUser({ id: chatId, started, ...(needToSetDefaultSettings ? { settings: this.getDefaultSettings(false) } : {}), ...(started ? ctx.from : {}) });
        }
    }

    replyWarning(ctx, cmdName, warnText) {
        return this.replyOrDoNothing(
            ctx,
            this.emoji.warn + warnText + ' ' + (this.botCommands[cmdName].example || '')
        );
    }

    parseGameData(ctx, args, chatSettings) {
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
            // console.log(parsedDate);
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
            // console.log(stringDate);
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
            //console.log(JSON.stringify(obj));
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

    getCmdsByMainName(cmdName) {
        let item = this.botCommands[cmdName];
        if (!item || !item.aliases) return cmdName;
        return [cmdName, ...item.aliases]
    }

    getCmdsByName(cmdName) {
        const cmdNames = [];
        for (let key of Object.keys(this.botCommands)) {
            let aliases = this.botCommands[key].aliases;
            if (key === cmdName || (aliases && aliases.includes(cmdName))) {
                cmdNames.push(key, ...(aliases || []));
            }
        }
        if (!cmdNames.length) cmdNames.push(cmdName);
        return cmdNames;
    }

    _checkTimeZone(timezone, userId) {
        let timeZones = Intl.supportedValuesOf('timeZone');
        timeZones.push('Europe/Kyiv'); // тому що у цьому списку може бути тільки "Europe/Kiev"
        if (!timeZones.find(v => v === timezone)) {
            this.sendMessage(userId, this.emoji.warn + 'Некоректне значення налаштування. Доспупні значення: ' + JSON.stringify(timeZones));
            return false;
        }
        return true;
    }

    _checkNotificationTerms(notificationTerms, userId) {
        if (notificationTerms.trim().length === 0) return true;
        const notificationTermsArray = notificationTerms.split(',').map(Number);
        if (notificationTermsArray.includes(NaN)) {
            this.sendMessage(userId, this.emoji.warn + 'Некоректне значення налаштування.');
            return false;
        }
        return true;
    }

    async getChatAdmins(chatId) {
        return await this.bot.telegram.getChatAdministrators(chatId);
    }

    buildTextMessageOfCurrentSettings(settings, chatId, chatName) {
        let extra = ''
        if (this.isGroup(chatId)) {
            const chatTitle = chatName;
            extra = ' для групи ' + chatTitle;
        }
        return this.emoji.setup + ' Поточні налаштування' + extra + ':\n\n' + JSON.stringify(settings || {}, null, 2)
    }

    async updateSetingsMessage(chatId, messageId, settings, chatIdForSettings, chatNameForSettings) {
        // console.log(chatId, messageId, settings, chatNameForSettings);
        try {
            await this.bot.telegram.editMessageText(
                chatId,
                messageId,
                null,
                this.buildTextMessageOfCurrentSettings(settings, chatIdForSettings, chatNameForSettings),
                { reply_markup: this.currentMarkup[messageId] }
            );
        } catch (error) {
            // Bad Request: message is not modified:
            const desc = error?.response?.description || error?.description || '';
            if (error?.response?.error_code === 400 && desc.includes('message is not modified')) {
                return;
            }
            console.error(error);
        }
    }

    getMarkupForSettings(chatId) {
        const buttons = [
            [Markup.button.callback(this.emoji.setup + ' Змінити налаштування', `settings_${chatId}`)]
        ];
        if (this.isGroup(chatId))
            buttons.push([Markup.button.callback(this.emoji.access + ' Змінити права та доступ', `permissions_${chatId}`)]);
        return Markup.inlineKeyboard(buttons);
    }
}

module.exports = Bot;