const Config = require('./src/config/Config');
const Database = require('./src/database/Database');
const WebServer = require('./src/webserver/WebServer');
const Bot = require('./src/bot/Bot');
const Scheduler = require('./src/scheduler/Scheduler');

class PadelBotApp {
    constructor() {
        this.config = new Config();
        this.database = new Database(this.config.mongoUri, this.config.dbName);
        this.webServer = null;
        this.bot = null;
        this.scheduler = null;
    }

    async start() {
        console.log(`Date on server ${new Date()}`);
        
        // Connect to database
        await this.database.connect();

        // Initialize web server if needed
        if (this.config.useExpress) {
            this.webServer = new WebServer(this.config.port);
            this.webServer.start();
        }

        // Initialize bot
        this.bot = new Bot(this.config.botToken, this.database, this.webServer);

        // Initialize scheduler
        this.scheduler = new Scheduler(this.database, this.bot);
        this.scheduler.start();

        // Setup graceful shutdown
        this.setupGracefulShutdown();

        // Launch bot
        await this.launchBot();
    }

    async launchBot() {
        const onLaunch = () => {
            console.log(`Bot is running in ${this.config.usePolling ? 'polling' : 'webhook'} mode!`);
            const data = this.bot.botInfo;
            this.bot.setBotInfo(data.username, `https://t.me/${data.username}`);
            console.log(data.username, `https://t.me/${data.username}`);
        };

        let config = this.config.botConfig;

        if (this.config.useExpress) {
            if (!this.config.usePolling) {
                this.bot.botInfo = await this.bot.telegram.getMe();
                onLaunch();
                this.bot.webhookServer = null; // important to avoid: throw new Error('Bot is not running!');
                config.domain = this.config.webhookDomain;
                this.webServer.getApp().use(await this.bot.createWebhook(config));
                return;
            }
        }

        if (!this.config.usePolling) {
            config.webhook = this.config.webhookConfig;
        }
        
        await this.bot.launch(config, onLaunch);
    }

    setupGracefulShutdown() {
        process.once('SIGINT', () => this.shutdown('SIGINT'));
        process.once('SIGTERM', () => this.shutdown('SIGTERM'));
    }

    async shutdown(signal) {
        console.log(`Received ${signal}, shutting down gracefully...`);
        
        if (this.scheduler) {
            this.scheduler.stop();
        }
        
        if (this.bot) {
            this.bot.stop(signal);
        }
        
        if (this.database) {
            await this.database.disconnect();
        }
        
        process.exit(0);
    }
}

// Start the application
const app = new PadelBotApp();
app.start().catch(error => {
    console.error('Failed to start application:', error);
    process.exit(1);
});

