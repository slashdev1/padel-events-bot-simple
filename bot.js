const { Telegraf, Markup } = require('telegraf');
const packageData = require('./package.json');
const botCommands = require('./commands-descriptions.json');
const emoji = require('./emoji.json');
const {str2params, isTrue, date2int, date2text, parseDate, getStatusByAction, textMarkdownNormalize, extractUserTitle} = require('./utils');

class TGBot {
    constructor(token, database, usePooling, webserver, webhookDomain, webhookPort) {
        this.bot = new Telegraf(token);
        this.db = database;
        this.usePooling = usePooling;
        this.webserver = webserver;
        this.webhookDomain = webhookDomain;
        this.webhookPort = webhookPort;
        this.botName = '';
        this.botUrl = '';

        // Set up command & action handlers
        this.setupCommandHandlers();
        this.setupActionHandlers();

        // Set up crons
        this.setupCronJobs();
    }

    async start() {
        const config = {};
        if (!this.usePooling && this.webserver ) {
            config.domain = this.webhookDomain;

            // emulate function launch from telegraf.js
            this.bot.botInfo = await this.bot.telegram.getMe();
            this.onLaunch();

            this.bot.webhookServer = null; // important to avoid: throw new Error('Bot is not running!');
            this.webserver.use(await this.bot.createWebhook(config));

            this.enableGracefulStop();
            return;
        }

        if (!this.usePooling) {
            config.webhook = {
                domain: this.webhookDomain,
                port: this.webhookPort
            };
        }

        await this.bot.launch(config, this.onLaunch.bind(this));

        this.enableGracefulStop();
    }

    onLaunch() {
        console.log('Bot is running!');
        this.botName = this.bot.botInfo.username;
        this.botUrl = `https://t.me/${this.botName}`;
        this.webserver && this.webserver.updateExtraData({
            botName: this.botName,
            botUrl: this.botUrl
        });
        console.log(this.botUrl);

        //this.bot.telegram.sendMessage(923347354, 'test message', { parse_mode: 'Markdown' });
    }

    enableGracefulStop() {
        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }

    setupCommandHandlers() {
        this.bot.command('start', this.handleStart.bind(this));
        this.bot.command('help', this.handleHelp.bind(this));
        this.bot.command('__ver', this.handleVersion.bind(this));
        this.bot.command('__time', this.handleTime.bind(this));
    //     this.bot.command('add_game', this.handleAddGame.bind(this));
        this.bot.command('active_games', this.handleActiveGames.bind(this));
    }

    setupActionHandlers() {
    //     this.bot.action(/^join_(.*)$/, ctx => this.handleGameAction(ctx, 'join'));
    //     this.bot.action(/^pending_(.*)$/, ctx => this.handleGameAction(ctx, 'pending'));
    //     this.bot.action(/^decline_(.*)$/, ctx => this.handleGameAction(ctx, 'decline'));
    }

    setupCronJobs() {
    //     // Deactivate old games
    //     cron.schedule('*/15 * * * *', async () => {
    //         const result = await this.db.deactivateOldGames(new Date());
    //         if (result.modifiedCount) {
    //             console.log(`Deactivated ${result.modifiedCount} tasks`);
    //         }
    //     });

    //     // Notifications
    //     cron.schedule('0 18 * * *', () => {
    //         this.sendGameNotifications('tomorrow');
    //     });

    //     cron.schedule('0 10 * * *', () => {
    //         this.sendGameNotifications('today');
    //     });
    }

    // Command handlers
    async handleStart(ctx) {
        const user = ctx.from;
        await this.db.updateUser({...user, started: true, startedTimestamp: new Date()});
        let message = botCommands['start']?.description;
        if (!message) return;

        let tpl = eval('`'+message+'`');
        if (ctx.chat.id < 0) {
            await this.bot.telegram.sendMessage(user.id, tpl, { parse_mode: 'Markdown' });
        } else {
            await ctx.reply(tpl);
        }
    }

    handleVersion(ctx) {
        this.tryToReplyToUserDirect(ctx, packageData.version);
    };

    handleTime(ctx) {
        const now = new Date();
        this.tryToReplyToUserDirect(ctx, `Час на сервері:\n${now}\n${now.toISOString()}\n${now.toLocaleString()}`);
    };

    handleHelp(ctx) {
        ctx.reply('👾 Список команд, що підтримуються:\n' +
            Object.keys(botCommands)
                .filter(key => botCommands[key].isDisplayable !== false)
                .map(key => {
                    let cmd = botCommands[key];
                    return `    /${key} - ${cmd.description} ${cmd.example || ''}`;
                }).join('\n') + botCommands['help'].extra || ''
        );
    }

    async handleActiveGames(ctx) {
        const chatId = ctx.chat.id;
        const userId = ctx.from.id;
        const filter = { isActive: true, date: {$gte: new Date()} };
        let where = '';
        if (chatId < 0) {
            filter.chatId = chatId;
            where = ' у ' + ctx.chat.title;
        }
        const games = await this.db.games().find(filter).toArray();
        let message = `Немає активних ігор${where}.`;
        if (games.length) {
            const lines = [];
            games.forEach(game => {
                //let gameDate = date2int(game.date);
                //if (gameDate && gameDate + 86400000 < Date.now()) return;
                let status = ' Ще не має статусу';
                let ind = game.players.filter(p => p.status === 'joined').sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).findIndex(p => p.id === userId);
                if (ind >= 0 && ind < game.maxPlayers) status = '✅ Йду';
                if (ind >= 0 && ind >= game.maxPlayers) status = '⏳ У черзі';
                if (game.players.some(p => p.id === userId && p.status === 'pending')) status = '❓ Думаю';
                if (game.players.some(p => p.id === userId && p.status === 'declined')) status = '❌ Не йду';
                lines.push({gameDate: game.date, text: `📅 **${game.name} (${date2text(game.date)})** - ${status}`});
            });
            if (lines.length) {
                lines.sort((a, b) => (a.gameDate || 0) - (b.gameDate || 0));
                message = `📋 **Активні ігри${where}:**\n\n` + lines.map(elem => elem.text).join(`\n`);
            }
        }
        this.replyToUser(ctx, message);
    }

    // // ... implement other handlers similarly

    // // Helper methods
    // buildGameMessage(game) {
    //     // Implementation of message building logic
    // }

    // buildGameMarkup(gameId) {
    //     return Markup.inlineKeyboard([
    //         Markup.button.callback('✅ Йду', `join_${gameId}`),
    //         Markup.button.callback('❓ Подумаю', `pending_${gameId}`),
    //         Markup.button.callback('❌ Не йду', `decline_${gameId}`),
    //         Markup.button.callback('✅ Йду +', `join_${gameId}_plus`),
    //         Markup.button.callback('❌ Не йду -', `decline_${gameId}_minus`)
    //     ], {columns: 3});
    // }

    async tryToReplyToUserDirect(ctx, message) {
        const userId = ctx.from.id;
        const user = await this.db.findUser(userId);
        let sent = false;
        try {
            await this.bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
            sent = true;
        } catch (error) {
            //console.error(JSON.stringify(error));
            if (error?.code === 403) {
                this.db.updateUser({...ctx.from, started: false, startedTimestamp: new Date()});
                return;
            }
        }
        if (sent && !user?.started) this.db.updateUser({...ctx.from, started: true, startedTimestamp: new Date()});
    }

    async replyToUser(ctx, message) {
        const userId = ctx.from.id;
        const user = await this.db.findUser(userId);
        if (user && user.started) {
            try {
                await this.bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
            } catch (error) {
                //console.error(JSON.stringify(error));
                if (error?.code === 403) {
                    this.replyWarningAboutFollowing(ctx);
                    this.db.updateUser({...ctx.from, started: false, startedTimestamp: new Date()});
                } else
                    ctx.reply(message);
            }
        } else
            this.replyWarningAboutFollowing(ctx);
    }

    replyWarningAboutFollowing(ctx) {
        ctx.reply(`Для отримання повідомлень від бота перейдіть на нього ${this.botUrl} та натисніть Start.`);
    }
}

module.exports = TGBot;