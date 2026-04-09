const { MongoClient, ObjectId } = require('mongodb');
const Cache = require('./Cache');
const Config = require('./Config');
const { sleep } = require('../helpers/utils');

class Database {
    constructor(mongoUri, dbName) {
        this.mongoUri = mongoUri;
        this.dbName = dbName;
        this.client = new MongoClient(mongoUri);
        this.db = null;
        this.bot = null;

        const config = new Config();

        // Generic TTL cache for database lookups
        this.cache = new Cache({
            defaultTtlMs: config.cacheDefaultTTL,
            cleanupIntervalMs: config.cacheCleanupInterval
        });

        // Optional per-key TTL overrides
        const defaultTtlMs = 60 * 1000;
        this.ttlChatSettingsMs = Number(config.cacheTtlChatSettings || defaultTtlMs);
        this.ttlGlobalSettingsMs = Number(config.cacheTtlGlobalSettings || defaultTtlMs);
        this.ttlUserDataMs = Number(config.cacheTtlUserData || defaultTtlMs);
        this.ttlLicensesMs = Number(config.cacheTtlLicenses || defaultTtlMs);
        // this.ttlGameDataMs = Number(config.cacheTtlGameData || defaultTtlMs);
    }

    setBot(bot) {
        this.bot = bot;
    }

    async connect() {
        await this.client.connect();
        this.db = this.client.db(this.dbName);
        console.log(`Connected to MongoDB (db ${this.dbName})`);
    }

    async disconnect() {
        await this.client.close();
        console.log('Disconnected from MongoDB');
    }

    // Collection getters
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

    licensesCollection() {
        return this.db.collection('licenses');
    }

    _id(id) {
        return typeof id === 'string' ? ObjectId.createFromHexString(id) : id;
    }

    // Game operations
    async createGame(gameData) {
        const result = await this.gamesCollection().insertOne(gameData);
        return result.insertedId;
    }

    // async getGame(gameId, direct = false) {
    //     const fn = () => this.gamesCollection().findOne({ _id: this._id(gameId) });
    //     if (!direct) return await fn();

    //     const cacheKey = `Game:${gameId}`;
    //     return await this.cache.getOrSet(
    //         cacheKey,
    //         fn,
    //         this.ttlGameDataMs
    //     );
    // }
    async getGame(gameId) {
        return await this.gamesCollection().findOne({ _id: this._id(gameId) });
    }

    async updateGame(gameId, updateData) {
        updateData.updatedDate = new Date();
        const result = await this.gamesCollection().updateOne(
            { _id: this._id(gameId)},
            { $set: updateData }
        );
        // if (result.modifiedCount) {
        //     // refresh cache with actual data of game
        //     await this.getGame(gameId, true);
        // }
        return result;
    }

    async deactivateGame(gameId) {
        return await this.gamesCollection().updateOne(
            { _id: this._id(gameId) },
            { $set: { isActive: false } }
        );
    }

    async deactivateExpiredGames() {
        const now = new Date();
        const startOfDate = now.startOfDay();
        //console.log(now, 'Deactivation...');

        const filter = {
            isActive: true,
            $or: [
                // 1. Якщо є хоча б одна підгра з датою (дата гри у такому випадку не має значення), і ВСІ такі дати вже в минулому
                {
                    subgames: {
                        $elemMatch: { date: { $exists: true, $ne: null } }, // є хоча б одна дата
                        $not: {
                            $elemMatch: {
                                $or: [
                                    // актуальна підгра з часом
                                    {
                                        date: { $gte: now },
                                        isDateWithoutTime: false
                                    },
                                    // актуальна підгра без часу (сьогоднішня або майбутня)
                                    {
                                        date: { $gte: startOfDate },
                                        isDateWithoutTime: { $ne: false }
                                    }
                                ]
                            }
                        }
                    }
                },
                // 2. Якщо основна дата гри минула
                {
                    date: { $ne: null, $lte: now },
                    isDateWithoutTime: false
                },
                // 3. Якщо дата без часу минула
                {
                    date: { $ne: null, $lt: startOfDate },
                    isDateWithoutTime: { $ne: false }
                },
                // 4. ЗАХИСНИЙ ВАРІАНТ:
                // Якщо немає жодної валідної дати ні в game, ні в subgames
                // Чекаємо 7 днів від створення
                {
                    $and: [
                        { date: null },
                        {
                            $or: [
                                { subgames: { $exists: false } },
                                { subgames: { $not: { $elemMatch: { date: { $ne: null } } } } }
                            ]
                        },
                        { createdDate: { $lt: startOfDate.addDays(-7) } }
                    ]
                }
            ]
        };
        //console.log(now, filter);

        // const result = await this.gamesCollection().updateMany(filter, { $set: { isActive: false } });
        // if (result.modifiedCount) {
        //     console.log(`Deactivated ${result.modifiedCount} games`);
        // }
        const gamesToDeactivate = await this.gamesCollection()
            .find(filter)
            .toArray();
        let result;

        if (gamesToDeactivate.length > 0) {
            result = await this.gamesCollection().updateMany(filter, { $set: { isActive: false } });
            if (result.modifiedCount) {
                console.log(`Deactivated ${result.modifiedCount} games:`);

                for (const game of gamesToDeactivate) {
                    try {
                        game.isActive = false;
                        const gameId = game._id.toHexString();
                        console.log(`    id=${gameId}, ${game.name}`);
                        if (this.bot?.updateGameMessage) {
                            await this.bot.updateGameMessage(game, gameId);
                        }
                    } finally {
                        await sleep(100);
                    }
                }
            }
        } else
            result = true;
        return result;
    }

    async getGamesForNotification(dateStart, dateEnd, onlyIfDateWithTime = false) {
        const filter = {
            isActive: true,
            date: { $gte: dateStart, $lte: dateEnd },
            ...(onlyIfDateWithTime && { isDateWithoutTime: false })
        };
        return await this.gamesCollection().find(filter).toArray();
    }

    async getActiveGamesWithChatSettings(filter) {
        return await this.gamesCollection().aggregate([
            {
                $match: { ...filter, isActive: true }
            },
            {
                $lookup: {
                    from: 'chatSettings',
                    localField: 'chatId',
                    foreignField: 'chatId',
                    as: 'chatSettings'
                }
            },
            { $unwind: { path: '$chatSettings', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 1,
                    name: 1,
                    date: 1,
                    isDateWithoutTime: 1,
                    chatId: 1,
                    chatName: 1,
                    messageId: 1,
                    maxPlayers: 1,
                    players: 1,
                    subgames: 1,
                    //sentReminders: 1,
                    timezone: '$chatSettings.timezone',
                    notificationTerms: '$chatSettings.notificationTerms',
                    license: '$chatSettings.license'
                }
            }
        ]).toArray();
    }

    // User operations
    async getUser(userId) {
        const cacheKey = `User:${userId}`;
        return await this.cache.getOrSet(
            cacheKey,
            async () => this.getUserFromDB(userId), //await this.usersCollection().findOne({ userId }),
            this.ttlUserDataMs
        );
    }

    async getUserFromDB(userId) {
        return await this.usersCollection().findOne({ userId });
    }

    async updateUser(userData, force) {
        const fields = {};
        if ('id' in userData) fields.userId = userData.id;
        if ('started' in userData) {
            fields.started = userData.started;
            if (fields.started) fields.startedTimestamp = new Date();
        }
        if ('first_name' in userData) fields.firstName = userData.first_name;
        if ('last_name' in userData) fields.lastName = userData.last_name;
        if ('username' in userData) fields.username = userData.username;

        const fieldsForInsert = {};
        if ('settings' in userData) {
            const transformed = Object.entries(userData.settings).reduce((acc, [key, value]) => {
                acc[`settings.${key}`] = value;
                return acc;
            }, {});
            Object.assign(force === true ? fields : fieldsForInsert, transformed);
        }

        fields.updatedDate = new Date();
        fieldsForInsert.createdDate = new Date();

        const result = await this.usersCollection().updateOne(
            { userId: userData.id },
            { $set: fields, $setOnInsert: fieldsForInsert},
            { upsert: true }
        );
        if (result?.modifiedCount) {
            const cacheKey = `User:${userData.id}`;
            this.cache.set(cacheKey, { ...fieldsForInsert, ...fields }, this.ttlUserDataMs);
        }
        return result;
    }

    // Chat settings operations
    async getChatSettings(chatId) {
        const cacheKey = `chatSettings:${chatId}`;
        return await this.cache.getOrSet(
            cacheKey,
            async () => await this.chatSettingsCollection().findOne({ chatId }),
            this.ttlChatSettingsMs
        );
    }

    async createChatSettings(chatSettings) {
        const result = await this.chatSettingsCollection().insertOne(chatSettings);
        if (chatSettings && chatSettings.chatId) {
            const cacheKey = `chatSettings:${chatSettings.chatId}`;
            this.cache.set(cacheKey, chatSettings, this.ttlChatSettingsMs);
        }
        return result;
    }

    async updateChatSettings(chatSettings, fnMakeChatSettings) {
        const { chatId } = chatSettings;
        const chatSettingsFromDB = await this.getChatSettings(chatId);
        if (chatSettingsFromDB) {
            const updateData = { ...chatSettingsFromDB, ...chatSettings, updatedDate: new Date() };
            await this.chatSettingsCollection().updateOne({ chatId }, { $set: updateData });
            const cacheKey = `chatSettings:${chatId}`;
            this.cache.set(cacheKey, updateData, this.ttlChatSettingsMs);
            return updateData;
        } else if (typeof fnMakeChatSettings === 'function') {
            const updateData = { ...await fnMakeChatSettings(), ...chatSettings, updatedDate: new Date() };
            this.createChatSettings(updateData);
            return updateData;
        }
        return undefined;
    }

    // Global settings operations
    async getGlobalSettings() {
        const cacheKey = 'globalSettings';
        return await this.cache.getOrSet(
            cacheKey,
            async () => await this.globalSettingsCollection().findOne(),
            this.ttlGlobalSettingsMs
        );
    }

    // Licenses
    async getLicenses() {
        const cacheKey = `licenses`;
        return await this.cache.getOrSet(
            cacheKey,
            async () => await this.licensesCollection().find({}).toArray(),
            this.ttlLicensesMs
        );
    }
}

module.exports = Database;

