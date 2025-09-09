const express = require('express');

class WebServer {
    constructor(port) {
        this.port = port;
        this.app = null;
        this.extraData = {};
    }

    updateExtra(extra) {
        this.extraData = { ...this.extraData, ...extra };
    }

    createApp() {
        this.app = express();

        this.app.get('/', (req, res) => {
            res.send(`Bot is running! Follow to <a href="${this.extraData?.botUrl}">${this.extraData?.botUrl}</a>`);
        });

        return this.app;
    }

    start() {
        if (!this.app) {
            this.createApp();
        }

        this.app.listen(this.port, () => {
            console.log(`Express app listening on port ${this.port}`);
        });

        return this.app;
    }

    getApp() {
        return this.app;
    }
}

module.exports = WebServer;

