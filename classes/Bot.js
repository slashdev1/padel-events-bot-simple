const { Telegraf, Markup } = require('telegraf');
const {
    str2params,
    // date2int,
    // date2text,
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
    formatToTimeZone
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
    }

    setupActions() {
        this.bot.action(/^join_(.*)$/, (ctx) => this.updateGameStatus(ctx, 'join'));
        this.bot.action(/^pending_(.*)$/, (ctx) => this.updateGameStatus(ctx, 'pending'));
        this.bot.action(/^decline_(.*)$/, (ctx) => this.updateGameStatus(ctx, 'decline'));
        this.bot.action(/^activation_(.*)$/, (ctx) => this.handleGameActivation(ctx));
        this.bot.action(/^notification_(.*)$/, (ctx) => this.handleGameNotification(ctx));
        this.bot.action(/^none$/, (ctx) => this.showPopup(ctx, this.emoji.warn + 'Натискайте на кнопки нище.'));
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

        let { error, name, maxPlayers, date, isDateWithoutTime, subgames } = this.parseGameData(args, chatSettings);
        if (error) return error;

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
            date: subgames && subgames.some(item => item.date instanceof Date && !isNaN(item.date)) ? null : date,
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

        if (game.isActive) await this.database.deactivateGame(gameId);
        try {
            await this.bot.telegram.deleteMessage(game.chatId, game.messageId);
        } catch (error) {
            console.error(error); // TelegramError: 400: Bad Request: message to edit not found
            //await this.replyToUser(ctx, `Сталася помилка при спробі видалення повідомлення з грою: ${error?.code} - ${error?.description}`);
            try {
                game.isActive = false;
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
        await this.updateGameMessage(game);

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

        await this.updateGameMessage(game);
        return this.replyToUserDirectOrDoNothing(ctx, `Ігрока "${player}" виключено з гри "${game.name}".`);
    }

    async handleActiveGames(ctx) {
        const chatId = this.getChatId(ctx);
        const userId = this.getUserId(ctx);
        const filter = { isActive: true };
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
                // let gameDate = date2int(game.date);
                // if (gameDate && gameDate + 86400000 < Date.now()) return;
                let gameDate = game.date;
                let subgame = game.subgames.find(item => item.date instanceof Date && !isNaN(item.date) && item.date > now);
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
        const tz = chatSettings?.timezone || this.getDefaultSettings().timezone;
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

    async updateGameStatus_old(ctx, action) {
        const [fullGameId, extraAction] = ctx.match[1].split('_');
        const [gameId, subgameIndex] = fullGameId.split('/');
        const userId = this.getUserId(ctx);
        const username = extractUserTitle(ctx.from);
        const fullName = extractUserTitle(ctx.from, false);
        const timestamp = new Date();

        const game = await this.database.getGame(gameId);
        if (!game) return this.showPopup(ctx, this.emoji.notfound + 'Гру не знайдено.');
        if (!game.isActive) return this.showPopup(ctx, this.emoji.warn + 'Гра неактивна.');

        const chatSettings = await this.database.getChatSettings(game.chatId);
        if (!chatSettings || (chatSettings.botStatus && chatSettings.botStatus !== 'member')) return console.error(`Важливо (updateGameStatus_old): бот не є членом групи ${chatSettings.chatName} (id=${game.chatId})`);

        const newStatus = getStatusByAction(action);
        let playerInd = game.players.findIndex(p => p.id === userId && !p.extraPlayer && (!subgameIndex || p.subgameIndex === +subgameIndex));
        if (playerInd >= 0 && game.players[playerInd].status === 'kicked') {
            // return this.replyToUser(ctx, "Ви не можете змінити статус, бо вас виключено з гри.");
            return this.showPopup(ctx, this.emoji.kick + 'Вас виключено з гри.');
        }
        if (extraAction && (playerInd == -1 || game.players[playerInd].status !== 'joined')) {
            // return this.replyToUser(ctx, 'Перед тим як додавати/видаляти ігрока натисніть що Ви самі йдете на гру.');
            return this.showPopup(ctx, this.emoji.warn + 'Спершу натисніть що ви самі йдете на гру.');
        }
        let extraPlayer = game.players.length && Math.max(...game.players.map(p => p.id === userId && p.extraPlayer && (!subgameIndex || p.subgameIndex === +subgameIndex))) || 0;
        if (extraAction) {
            if (extraAction === 'minus') {
                if (extraPlayer <= 0) {
                    return this.showPopup(ctx, this.emoji.warn + 'Немає додаткових ігроків, яких ви залучили.');
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
                    return this.showPopup(ctx, this.emoji.warn + 'Перед тим як змінювати свій статус видмініть похід на гру для додаткових ігроків, яких ви залучили.');
                } else if (newStatus === 'joined' && subgameIndex) {
                    const playersItem = game.players.find(p => p.id === userId && !p.extraPlayer && p.subgameIndex !== +subgameIndex && p.status === newStatus);
                    if (playersItem) return this.showPopup(ctx, this.emoji.warn + 'Ви вже йдете на гру ' + game.subgames[playersItem.subgameIndex]?.name + '.');
                }
                game.players.splice(playerInd, 1);
            } else if (newStatus === 'joined' && subgameIndex) {
                const playersItem = game.players.find(p => p.id === userId && !p.extraPlayer && p.subgameIndex !== +subgameIndex && p.status === newStatus);
                if (playersItem) return this.showPopup(ctx, this.emoji.warn + 'Ви вже йдете на гру ' + game.subgames[playersItem.subgameIndex]?.name + '.');
            }
        }

        if (extraAction !== 'minus')
            game.players.push({ id: userId, name: username, fullName: fullName, extraPlayer, status: newStatus, timestamp, subgameIndex: parseInt(subgameIndex) || 0 });
        game.players.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        await this.database.updateGame(game._id, { players: game.players });

        this.updateGameMessage(game);
        this.showPopup(ctx, '');
    }

    async updateGameStatus(ctx, action) {
        const [fullGameId, extraAction] = ctx.match[1].split('_');
        const [gameId, subgameIndex] = fullGameId.split('/');
        const userId = this.getUserId(ctx);
        const username = extractUserTitle(ctx.from);
        const fullName = extractUserTitle(ctx.from, false);
        const timestamp = new Date();

        const game = await this.database.getGame(gameId);
        if (!game) return this.showPopup(ctx, this.emoji.notfound + 'Гру не знайдено.');
        if (!game.isActive) return this.showPopup(ctx, this.emoji.warn + 'Гра неактивна.');

        const chatSettings = await this.database.getChatSettings(game.chatId);
        if (!chatSettings || (chatSettings.botStatus && chatSettings.botStatus !== 'member')) return console.error(`Важливо (updateGameStatus): бот не є членом групи ${chatSettings.chatName} (id=${game.chatId})`);

        const newStatus = getStatusByAction(action);
        let playerInd = game.players.findIndex(p => p.id === userId && !p.extraPlayer && (!subgameIndex || p.subgameIndex === +subgameIndex));
        if (playerInd >= 0 && game.players[playerInd].status === 'kicked') {
            return this.showPopup(ctx, this.emoji.kick + 'Вас виключено з гри.');
        }
        if (extraAction && (playerInd == -1 || game.players[playerInd].status !== 'joined')) {
            if (!chatSettings.allowVotePlusWithoutMainPlayers) {
                return this.showPopup(ctx, this.emoji.warn + 'Спершу натисніть що ви самі йдете на гру.');
            }
        }
        let extraPlayer = game.players.length && Math.max(...game.players.map(p => p.id === userId && p.extraPlayer && (!subgameIndex || p.subgameIndex === +subgameIndex))) || 0;
        if (extraAction) {
            if (extraAction === 'minus') {
                if (extraPlayer <= 0) {
                    return this.showPopup(ctx, this.emoji.warn + 'Немає додаткових ігроків, яких ви залучили.');
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
                    return this.showPopup(ctx, this.emoji.warn + 'Перед тим як змінювати свій статус видмініть похід на гру для додаткових ігроків, яких ви залучили.');
                } else {
                    const conflict = this.checkSubgameSignupConflict(game, chatSettings, userId, subgameIndex, newStatus);
                    if (conflict) return this.showPopup(ctx, conflict);
                }
                game.players.splice(playerInd, 1);
            } else {
                const conflict = this.checkSubgameSignupConflict(game, chatSettings, userId, subgameIndex, newStatus);
                if (conflict) return this.showPopup(ctx, conflict);
            }
        }

        if (extraAction !== 'minus')
            game.players.push({ id: userId, name: username, fullName: fullName, extraPlayer, status: newStatus, timestamp, subgameIndex: parseInt(subgameIndex) || 0 });
        game.players.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        await this.database.updateGame(game._id, { players: game.players });

        this.updateGameMessage(game);
        this.showPopup(ctx, '');
    }

    async handleGameActivation(ctx) {
        const cmdName = 'change_game';
        const gameId = ctx.match[1].split('_')[0];

        const game = await this.database.getGame(gameId);
        if (!game) return this.showPopup(ctx, this.emoji.notfound + 'Гру не знайдено.');

        const chatId = game.chatId;
        const chatSettings = await this.database.getChatSettings(chatId) || {};
        if (!await this.ensureAccess(ctx, this.getUserId(ctx), chatId, game.createdById, cmdName, chatSettings)) return;

        const updateData = {};
        updateData.isActive = !game.isActive;
        game.isActive = updateData.isActive;

        await this.database.updateGame(gameId, updateData);
        await this.updateGameMessage(game);

        //const replyText = `Ви щойно змінили гру "${game.name}" (id=${gameId}).`
        //this.replyToUserDirectOrDoNothing(ctx, replyText);
        this.showPopup(ctx, this.emoji.info + 'Гру ' + (game.isActive ? 'відкрито.' : 'закрито.'));
    }

    async handleGameNotification(ctx) {
        const gameId = ctx.match[1].split('_')[0];

        const game = await this.database.getGame(gameId);
        if (!game) return this.showPopup(ctx, this.emoji.notfound + ' Гру не знайдено.');

        let gameDate = game.date;
        let isDateWithoutTime = game.isDateWithoutTime;
        let subgame = game.subgames.find(item => item.date instanceof Date && !isNaN(item.date));
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
        if (!notification.isActive) return this.showPopup(ctx, this.emoji.bell + 'Нагадування про гру видалено. Не запізнюйтесь на гру.');
        this.showPopup(ctx, this.emoji.bell + 'Нагадаю вам про гру за 1 годину. Набирайтесь сил.');
    }

    buildTextMessage(game, chatSettings) {
        const players = game.players || [];
        const m = (user) => {
            const extra = (user.extraPlayer ? ' (+)' : '');
            return `[${user.fullName || user.name}${extra}](tg://user?id=${user.id})`;
        };
        const limit = game.maxPlayers || Infinity;
        //const dateText = game.date ? ` (${date2text(game.date)})` : '';
        let gameDate = game.date;
        //let chatSettings = await this.database.getChatSettings(game.chatId);
        let timezone = chatSettings?.timezone || this.getDefaultSettings().timezone;
        let dateText = '';
        if (gameDate) {
            dateText = formatToTimeZone(gameDate, timezone);
            //if (game.isDateWithoutTime)
                dateText = ` (${dateText.split(' ')[0]})`;
        }
        let gameText = '';
        if (game.subgames && game.subgames.length > 1) {
            for (let ind = 0, n = game.subgames.length; ind < n; ind++) {
                let subgame = game.subgames[ind];
                let separator = (ind === n - 1 ? '' : '—'.repeat(18)) + '\n';
                gameText +=
                `🏆 ${subgame.name}\n` +
                `👥 Кількість учасників ${players.filter(p => p.status === 'joined' && p.subgameIndex === ind).length}${subgame.maxPlayers ? '/' + subgame.maxPlayers : ''}\n` +
                `✅ Йдуть: ${players.filter(p => p.status === 'joined' && p.subgameIndex === ind).slice(0, limit).map(p => `\n✅ ${m(p)}`).join(', ') || '-'}\n` +
                `⏳ У черзі: ${players.filter(p => p.status === 'joined' && p.subgameIndex === ind).slice(limit).map(p => `\n⏳ ${m(p)}`).join(', ') || '-'}\n` +
                `❓ Думають: ${players.filter(p => p.status === 'pending' && p.subgameIndex === ind).map(p => `\n❓ ${m(p)}`).join(', ') || '-'}\n` +
                `❌ Не йдуть: ${players.filter(p => p.status === 'declined' && p.subgameIndex === ind).map(p => `\n❌ ${m(p)}`).join(', ') || '-'}\n${separator}`;
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

    buildMarkup(game) {
        if (!game) return null;

        const gameId = game._id.toHexString();
        const buttons = [];
        buttons.push([
            Markup.button.callback(game.isActive ? '⏸️ Закрити гру' : '▶️ Відкрити гру', `activation_${gameId}`),
            ...(game.isActive ? [Markup.button.callback(this.emoji.bell + 'Нагадати за 1 год.', `notification_${gameId}`)] : [])
        ]);
        if (!game.isActive) return Markup.inlineKeyboard(buttons);

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
            await sleep(100);
        }

        return responses; // Повертаємо масив відповідей від API
    }

    showPopup(ctx, msg) {
        ctx.answerCbQuery(msg, {
            show_alert: msg.length > 50
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

    getDefaultSettings() {
        return {
            license: this.config.licenseClientDefault || 'free',
            timezone: this.config.timezoneClientDefault,
            notificationTerms: this.config.notificationTerms || '-1440,-60'
        };
    }

    getDefaultPermissions(license) {
        return [
            { command: 'add_game', appliesTo: 'all' },
            { command: 'del_game', appliesTo: 'admins,author' },
            { command: 'change_game', appliesTo: 'admins,author' },
            { command: 'kick', appliesTo: 'admins,author' }
        ];
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
            permissions: this.getDefaultPermissions(config.license),
            features: [],
            timezone: config.timezone,
            notificationTerms: config.notificationTerms,
            allowVotePlusWithoutMainPlayers: false
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
            console.log(parsedDate);
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
            console.log(stringDate);
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
}

module.exports = Bot;