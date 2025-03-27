class Webserver {
    _app;
    extraData;

    constructor(port) {
        // this.client = new MongoClient(uri);
        // this.dbName = dbName;
        // this.db = null;
        this.port = port;
    }

    async start(extraData) {
        // await this.client.connect();
        // this.db = this.client.db(this.dbName);
        // console.log(`Connected to MongoDB (db ${this.dbName})`);

        // // Enable graceful stop
        // process.once('SIGINT', () => this.disconnect());
        // process.once('SIGTERM', () => this.disconnect());
        this.updateExtraData(extraData);
        this._app = require('express')();

        this._app.get('/', (req, res) => {
            res.send(`Bot is running! Follow to <a href="${this.extraData?.botUrl}">${this.extraData?.botUrl}</a>`);
        })

        this._server = this._app.listen(this.port, () => {
            console.log(`Webserver (Express) listening on port ${this.port}`);
        })

        this.enableGracefulStop();
    }

    enableGracefulStop() {
        process.once('SIGINT', async () => await this.stop());
        process.once('SIGTERM', async () => await this.stop());
    }

    async stop() {
        await this._server.close(() => console.log(`Webserver (Express) is closed`));
    }


    updateExtraData(extraData) {
        this.extraData = extraData;
    }

    use(middlewareFn) {
        this._app.use(middlewareFn);
    }
}

module.exports = Webserver;