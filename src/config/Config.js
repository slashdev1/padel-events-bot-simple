const loadEnvConfig = require('../../env');

class Config {
    constructor() {
        this.loadEnvironment();
    }

    loadEnvironment() {
        loadEnvConfig();
    }

    // Bot configuration
    get botToken() {
        return process.env.PADEL_BOT_TOKEN;
    }

    get useExpress() {
        return this.isTrue(process.env.USE_EXPRESS);
    }

    get usePolling() {
        return this.isTrue(process.env.PADEL_BOT_USE_PULLING);
    }

    get webhookDomain() {
        return process.env.PADEL_BOT_WEBHOOK_DOMAIN;
    }

    get webhookPort() {
        return process.env.PADEL_BOT_WEBHOOK_PORT;
    }

    // Database configuration
    get mongoUri() {
        return process.env.PADEL_MONGO_URI;
    }

    get dbName() {
        return process.env.PADEL_DB_NAME;
    }

    // Server configuration
    get port() {
        return process.env.PORT;
    }

    // Utility methods
    isTrue(str) {
        return ['1', 'true', 'yes'].indexOf((str || '').toLowerCase()) >= 0;
    }

    isFalse(str) {
        return !this.isTrue(str);
    }

    // Bot launch configuration
    get botConfig() {
        return {
            allowed_updates: [
                'update_id',
                'message',
                'edited_message',
                'channel_post',
                'edited_channel_post',
                'inline_query',
                'chosen_inline_result',
                'callback_query',
                'shipping_query',
                'pre_checkout_query',
                'poll',
                'poll_answer',
                'my_chat_member',
                'chat_member',
                'chat_join_request',
            ]
        };
    }

    get webhookConfig() {
        if (!this.usePolling) {
            return {
                domain: this.webhookDomain,
                port: this.webhookPort
            };
        }
        return {
            domain: this.webhookDomain
        };
    }
}

module.exports = Config;

