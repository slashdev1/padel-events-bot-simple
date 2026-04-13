class Migration {
    constructor(database) {
        this.database = database;
        this.version = require('../package.json').version;
        this.dbVersion = null;
    }

    _insertManyErrorsAllDuplicate(err) {
        if (this.database._isDuplicateKeyError(err)) return true;
        const errs = err?.writeErrors;
        return Array.isArray(errs) && errs.length > 0 && errs.every((w) => w.code === 11000);
    }

    async run() {
        this.dbVersion = (await this.database.getGlobalSettings())?.version;
        if (this.dbVersion === this.version) return;

        if (!this.dbVersion || this.dbVersion < '0.18.260412') {
            await this.migrateTimeZoneNotificationTerms();
        }
        if (!this.dbVersion || this.dbVersion < '0.19.260413') {
            await this.migrateGamePlayersToCollection();
        }
        if (!this.dbVersion || this.dbVersion < '0.19.260414') {
            await this.migrateGameFieldIsActive();
        }

        await this.database.updateGlobalSettings({ version: this.version });
    }

    async migrateTimeZoneNotificationTerms() {
        console.log('Оновлення структури БД до версії 0.18.260412 (timezone у settings)');
        const result = await this.database.chatSettingsCollection().updateMany(
            {},
            [
                {
                    $set: {
                        settings: {
                            timezone: '$timezone',
                            notificationTerms: '$notificationTerms'
                        }
                    }
                },
                {
                    $unset: ['timezone', 'notificationTerms']
                }
            ]
        );

        console.log(`Оновлено документів chatSettings: ${result.modifiedCount}`);
    }

    async migrateGamePlayersToCollection() {
        console.log('Міграція гравців у колекцію gamePlayers (версія 0.19.260413)');
        const gamesColl = this.database.gamesCollection();
        const playersColl = this.database.gamePlayersCollection();

        const cursor = gamesColl.find({ 'players.0': { $exists: true } });

        let gamesProcessed = 0;
        for await (const game of cursor) {
            const oid = game._id;
            const embedded = game.players;
            if (!Array.isArray(embedded) || embedded.length === 0) continue;

            const existing = await playersColl.countDocuments({ gameId: oid });
            if (existing > 0) {
                await gamesColl.updateOne({ _id: oid }, { $unset: { players: '' } });
                gamesProcessed++;
                continue;
            }

            const docs = embedded.map((p) => ({
                gameId: oid,
                id: p.id,
                name: p.name,
                fullName: p.fullName,
                extraPlayer: p.extraPlayer ?? 0,
                status: p.status,
                timestamp: p.timestamp instanceof Date ? p.timestamp : new Date(p.timestamp || Date.now()),
                subgameIndex: p.subgameIndex ?? 0
            }));

            try {
                await playersColl.insertMany(docs, { ordered: false });
            } catch (err) {
                if (!this._insertManyErrorsAllDuplicate(err)) throw err;
            }

            if ((await playersColl.countDocuments({ gameId: oid })) > 0) {
                await gamesColl.updateOne({ _id: oid }, { $unset: { players: '' } });
            }
            gamesProcessed++;
        }

        const emptyUnset = await gamesColl.updateMany(
            { players: { $exists: true, $eq: [] } },
            { $unset: { players: '' } }
        );
        console.log(`Ігор з перенесеними гравцями: ${gamesProcessed}; очищено порожніх players: ${emptyUnset.modifiedCount}`);
    }

    async migrateGameFieldIsActive() {
        try {
            const result = await this.database.gamesCollection().updateMany(
            {}, // Знаходимо всі документи
            [
                {
                    $set: {
                        status: {
                            $cond: {
                                if: { $eq: ["$isActive", true] },
                                then: "active",
                                else: "expired"
                            }
                        }
                    }
                },
                {
                    $unset: "isActive" // Видаляємо старе поле
                }
            ]
            );

            console.log(`Оновлено документів: ${result.modifiedCount}`);
        } catch (error) {
            console.error("Помилка під час міграції:", error);
        }
    }
}

module.exports = Migration;
