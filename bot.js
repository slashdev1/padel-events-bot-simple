class TGBot {
    constructor(token, database) {
        this.bot = new Telegraf(token);
        this.db = database;
        this.botName = '';
        this.botUrl = '';
    }

    async initialize() {
        // Set up bot info
        this.bot.botInfo = await this.bot.telegram.getMe();
        this.botName = this.bot.botInfo.username;
        this.botUrl = `https://t.me/${this.botName}`;

        // Set up command handlers
        this.setupCommandHandlers();
        this.setupActionHandlers();
        this.setupCronJobs();

        // Enable graceful stop
        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }

    async start(config = {}) {
        if (config.webhook) {
            await this.bot.launch({
                webhook: {
                    domain: config.webhook.domain,
                    port: config.webhook.port
                }
            });
        } else {
            await this.bot.launch();
        }
        console.log('Bot is running!');
    }

    // setupCommandHandlers() {
    //     this.bot.command('start', this.handleStart.bind(this));
    //     this.bot.command('help', this.handleHelp.bind(this));
    //     this.bot.command('ver', this.handleVersion.bind(this));
    //     this.bot.command('time', this.handleTime.bind(this));
    //     this.bot.command('add_game', this.handleAddGame.bind(this));
    //     this.bot.command('active_games', this.handleActiveGames.bind(this));
    // }

    // setupActionHandlers() {
    //     this.bot.action(/^join_(.*)$/, ctx => this.handleGameAction(ctx, 'join'));
    //     this.bot.action(/^pending_(.*)$/, ctx => this.handleGameAction(ctx, 'pending'));
    //     this.bot.action(/^decline_(.*)$/, ctx => this.handleGameAction(ctx, 'decline'));
    // }

    // setupCronJobs() {
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
    // }

    // // Command handlers
    // async handleStart(ctx) {
    //     const user = ctx.from;
    //     await this.db.updateUser({...user, started: true, startedTimestamp: new Date()});
    //     let message = botCommands['start']?.description;
    //     if (!message) return;

    //     let tpl = eval('`'+message+'`');
    //     if (ctx.chat.id < 0) {
    //         await this.bot.telegram.sendMessage(user.id, tpl, { parse_mode: 'Markdown' });
    //     } else {
    //         await ctx.reply(tpl);
    //     }
    // }

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
}

module.exports = TGBot;