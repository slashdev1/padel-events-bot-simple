require('./config').loadEnvConfig();
const { str2params, isTrue, date2int, date2text, getStatusByAction, textMarkdownNormalize, extractUserTitle } = require('./utils');
const cron = require('node-cron');
const { Telegraf, Markup } = require('telegraf');
const { MongoClient, ObjectId } = require('mongodb');
const package = require('./package.json');
const botCommands = require('./commands-descriptions.json');
const emoji = require('./emoji.json');

class TeleBot {
    constructor() {
        this.bot = new Telegraf(process.env.PADEL_BOT_TOKEN);
        this.mongoClient = new MongoClient(process.env.PADEL_MONGO_URI);
        this.db = null;
        this.botName = null;
        this.botUrl = null;
        this.express = null;
        this.updateExtra = null;
    }

    async _run(onLaunch) {
        const config = this.getLaunchConfig();
        if (!isTrue(process.env.DO_NOT_USE_EXPRESS) && !isTrue(process.env.PADEL_BOT_USE_PULLING)) {
            this.bot.botInfo = await this.bot.telegram.getMe();
            onLaunch();
            this.bot.webhookServer = null; // important to avoid: throw new Error('Bot is not running!');
            this.app.use(await bot.createWebhook(config.webhook));
            return;
        }

        this.bot.launch(config, onLaunch);
    }

    async start() {
        console.log(`Date on server ${new Date()}`);
        await this.mongoClient.connect();
        this.db = this.mongoClient.db(process.env.PADEL_DB_NAME);
        console.log(`Connected to MongoDB (db ${process.env.PADEL_DB_NAME})`);

        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));

        this.bot.botInfo = await this.bot.telegram.getMe();
        this.botName = this.bot.botInfo.username;
        this.botUrl = `https://t.me/${this.botName}`;
        this.updateExtra({ botName: this.botName, botUrl: this.botUrl });
        console.log(this.botName, this.botUrl);

        if (!isTrue(process.env.DO_NOT_USE_EXPRESS)) {
            this.setupExpress();
        }

        this._run();
    }

    setupExpress() {
        this.express = require('./express').express;
        this.updateExtra = require('./express').updateExtra;
        const app = this.express(process.env.PORT);
        // if (!isTrue(process.env.PADEL_BOT_USE_PULLING)) {
        //     this.bot.webhookServer = null;
        //     app.use(this.bot.createWebhook({ domain: process.env.PADEL_BOT_WEBHOOK_DOMAIN }));
        // }
    }

    getLaunchConfig() {
        if (!isTrue(process.env.PADEL_BOT_USE_PULLING)) {
            return {
                webhook: {
                    domain: process.env.PADEL_BOT_WEBHOOK_DOMAIN,
                    port: process.env.PADEL_BOT_WEBHOOK_PORT
                }
            };
        }
        return {};
    }

    gamesCollection() {
        return this.db.collection('games');
    }

    usersCollection() {
        return this.db.collection('users');
    }

    globalSettingsCollection() {
        return this.db.collection('globalSettings');
    }

    chatSettingsCollection() {
        return this.db.collection('chatSettings');
    }

    async handleCommandStart(ctx) {
        const user = ctx.from;
        this.updateUser({ ...user, started: true, startedTimestamp: new Date() });
        const message = botCommands['start']?.description;
        if (!message) return;
        const tpl = eval('`' + message + '`');
        ctx.chat.id < 0 ? this.bot.telegram.sendMessage(user.id, tpl, { parse_mode: 'Markdown' }) : ctx.reply(tpl);
    }

    async handleCommandHelp(ctx) {
        ctx.reply('👾 Список команд, що підтримуються:\n' +
            Object.keys(botCommands)
                .filter(key => botCommands[key].isDisplayable !== false)
                .map(key => {
                    const cmd = botCommands[key];
                    return `    /${key} - ${cmd.description} ${cmd.example || ''}`;
                }).join('\n') + botCommands['help'].extra || ''
        );
    }

    async handleCommandVer(ctx) {
        this.replyToUserDirectOrDoNothing(ctx, package.version);
    }

    async handleCommandTime(ctx) {
        const now = new Date();
        this.replyToUserDirectOrDoNothing(ctx, `Час на сервері:\n${now}\n${now.toISOString()}\n${now.toLocaleString()}`);
    }

    async handleCommandAddGame(ctx) {
        const chatId = ctx.chat.id;
        let [cmdName, ...args] = str2params(ctx.message.text);
        cmdName = cmdName.slice(1);
        let chatSettings = await this.chatSettingsCollection().findOne({ chatId });
        if (!chatSettings) {
            chatSettings = this.initializeChatSettings(ctx, chatId);
            await this.chatSettingsCollection().insertOne(chatSettings);
        }
        const cmdPermission = chatSettings.permissions.find(elem => elem.command === cmdName);
        if (cmdPermission && !this.checkUserPermission(ctx, cmdPermission)) {
            return ctx.reply(emoji.noaccess + 'У вас немає повноважень на використання цієї команди.');
        }

        const creatorId = ctx.from.id;
        const creatorName = extractUserTitle(ctx.from, false);
        if (args.length < 3) return ctx.reply(emoji.warn + 'Передана некоректа кількість параметрів. ' + botCommands[cmdName].example);
        const stringDate = args[1];
        const parsedDate = this.parseDate(stringDate);
        if (!parsedDate) return ctx.reply(emoji.warn + 'Дату треба вказувати у такому форматі: 2025-03-25 або "2025-03-25 11:00"');
        let maxPlayers = parseInt(args[2]);
        if (!maxPlayers || maxPlayers <= 0) return ctx.reply('Кількість ігроків повинно бути числом більше 0.');

        const game = this.createGameObject(args, creatorId, creatorName, chatId, parsedDate, maxPlayers);
        const result = await this.gamesCollection().insertOne(game);
        const gameId = result.insertedId;
        const message = await this.writeGameMessage(ctx, game, gameId);
        await this.gamesCollection().updateOne({ _id: gameId }, { $set: { messageId: message.message_id } });
        if (game.isDateWithoutTime)
            this.replyToUserDirectOrDoNothing(ctx, emoji.warn + 'Для того щоб коректно нагадувати та деактивовувати ігри краще зазначати дату ігри разом з часом.');
    }

    initializeChatSettings(ctx, chatId) {
        return {
            chatId,
            chatName: ctx.chat.title,
            allMembersAreAdministrators: ctx.chat.all_members_are_administrators,
            level: 'free',
            reminders: [],
            admins: [],
            permissions: [],
            features: []
        };
    }

    checkUserPermission(ctx, cmdPermission) {
        let users = [];
        if (cmdPermission.appliesTo === 'all') users = undefined;
        else if (cmdPermission.appliesTo === 'admins') users = chatSettings.admins;
        else if (cmdPermission.appliesTo === 'users') users = cmdPermission.users;
        return !users || users.some(usr => usr.id === ctx.from.id);
    }

    createGameObject(args, creatorId, creatorName, chatId, parsedDate, maxPlayers) {
        return {
            createdDate: new Date(),
            createdById: creatorId,
            createdByName: creatorName,
            isActive: true,
            chatId,
            name: args[0],
            date: new Date(parsedDate),
            isDateWithoutTime: args[1].match(/\d+/g).length < 4,
            maxPlayers: maxPlayers,
            players: []
        };
    }

    async replyToUser(ctx, message) {
        const replyWarning = (ctx) => ctx.reply(`Для отримання повідомлень від бота перейдіть на нього ${this.botUrl} та натисніть Start.`);
        const userId = ctx.from.id;
        const user = await this.usersCollection().findOne({ userId });
        if (user && user.started) {
            try {
                await this.bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
            } catch (error) {
                if (error?.code === 403) {
                    replyWarning(ctx);
                    this.updateUser({ ...ctx.from, started: false, startedTimestamp: new Date() });
                } else {
                    ctx.reply(message);
                }
            }
        } else {
            replyWarning(ctx);
        }
    }

    async replyToUserDirectOrDoNothing(ctx, message) {
        const userId = ctx.from.id;
        const user = await this.usersCollection().findOne({ userId });
        let sent = false;
        try {
            await this.bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
            sent = true;
        } catch (error) {
            if (error?.code === 403) {
                this.updateUser({ ...ctx.from, started: false, startedTimestamp: new Date() });
                return;
            }
        }
        if (sent && !user?.started) this.updateUser({ ...ctx.from, started: true, startedTimestamp: new Date() });
    }

    updateUser(userData) {
        const fields = {};
        if ('id' in userData) fields.userId = userData.id;
        if ('started' in userData) fields.started = userData.started;
        if ('startedTimestamp' in userData) fields.startedTimestamp = userData.startedTimestamp;
        if ('first_name' in userData) fields.firstName = userData.first_name;
        if ('last_name' in userData) fields.lastName = userData.last_name;
        if ('username' in userData) fields.username = userData.username;
        this.usersCollection().updateOne(
            { userId: userData.id },
            { $set: fields },
            { upsert: true }
        );
    }

    // Additional methods for handling commands and game updates would go here...
}

const teleBot = new TeleBot();
teleBot.start();
