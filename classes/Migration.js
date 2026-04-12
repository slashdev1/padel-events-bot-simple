class Migration {
    constructor(database) {
        this.database = database;
        this.version = require('../package.json').version;
        this.dbVersion = null;
    }

    async run() {
        this.dbVersion = (await this.database.getGlobalSettings())?.version;
        if (this.version === this.dbVersion) return;

        switch (this.version) {
            case '0.18.260412':
                await this.migrateTimeZoneNotificationTerms();
                break;
        }

        this.database.updateGlobalSettings({ version: this.version });
    }

    async migrateTimeZoneNotificationTerms() {
        console.log('Оновлення структури БД до версії ' + this.version);
        const result = await this.database.chatSettingsCollection().updateMany(
            {},
            [
                {
                $set: {
                    settings: {
                        timezone: "$timezone",
                        notificationTerms: "$notificationTerms"
                    }
                }
                },
                {
                    $unset: ["timezone", "notificationTerms"]
                }
            ]
        );

        console.log(`Оновлено документів: ${result.modifiedCount}`);
    }
}

module.exports = Migration;