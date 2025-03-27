require('./config')();
const Database = require('./database');
const Webserver = require('./webserver');
const TGBot = require('./bot');
const { isTrue } = require('./utils');

async function main() {
    // Initialize database
    const database = new Database(
        process.env.PADEL_MONGO_URI,
        process.env.PADEL_DB_NAME
    );
    await database.connect();

    let webserver;
    if (isTrue(process.env.USE_EXPRESS)) {
        webserver = new Webserver(process.env.PORT);
        webserver.start({});
    }

    // Initialize bot
    const bot = new TGBot(
        process.env.PADEL_BOT_TOKEN,
        database,
        isTrue(process.env.PADEL_BOT_USE_PULLING),
        webserver,
        process.env.PADEL_BOT_WEBHOOK_DOMAIN,
        process.env.PADEL_BOT_WEBHOOK_PORT
    );
    //await bot.initialize();

    // Start bot with appropriate config
    // const config = {};
    // if (!isTrue(process.env.PADEL_BOT_USE_PULLING)) {
    //     config.webhook = {
    //         domain: process.env.PADEL_BOT_WEBHOOK_DOMAIN,
    //         port: process.env.PADEL_BOT_WEBHOOK_PORT
    //     };
    // }
    await bot.start(/*config*/);
}

main().catch(console.error);
