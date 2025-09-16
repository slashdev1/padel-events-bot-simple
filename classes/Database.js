const { MongoClient, ObjectId } = require('mongodb');
const Cache = require('./Cache');
const Config = require('./Config');

class Database {
    constructor(mongoUri, dbName) {
        this.mongoUri = mongoUri;
        this.dbName = dbName;
        this.client = new MongoClient(mongoUri);
        this.db = null;

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

    async getGame(gameId) {
        return await this.gamesCollection().findOne({ _id: this._id(gameId) });
    }

    async updateGame(gameId, updateData) {
        return await this.gamesCollection().updateOne(
            { _id: this._id(gameId)},
            { $set: updateData }
        );
    }

    async deactivateGame(gameId) {
        return await this.gamesCollection().updateOne(
            { _id: this._id(gameId) },
            { $set: { isActive: false } }
        );
    }

    async getActiveGames(filter = {}) {
        return await this.gamesCollection().find({ isActive: true, ...filter }).toArray();
    }

    async deactivateExpiredGames() {
        const date = new Date();
        const startOfDate = date.startOfDay();
        const filter = {
            $and: [
                { isActive: true },
                {
                    $or: [
                        { date: { $lte: date }, isDateWithoutTime: false },
                        { date: { $lt: startOfDate }, isDateWithoutTime: { $ne: false } }
                    ]
                }
            ]
        };

        const result = await this.gamesCollection().updateMany(filter, { $set: { isActive: false } });
        if (result.modifiedCount) {
            console.log(`Deactivated ${result.modifiedCount} games`);
        }
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

    // User operations
    async getUser(userId) {
        const cacheKey = `User:${userId}`;
        return await this.cache.getOrSet(
            cacheKey,
            async () => await this.usersCollection().findOne({ userId }),
            this.ttlUserDataMs
        );
    }

    async updateUser(userData) {
        const fields = {};
        if ('id' in userData) fields.userId = userData.id;
        if ('started' in userData) fields.started = userData.started;
        if ('startedTimestamp' in userData) fields.startedTimestamp = userData.startedTimestamp;
        if ('first_name' in userData) fields.firstName = userData.first_name;
        if ('last_name' in userData) fields.lastName = userData.last_name;
        if ('username' in userData) fields.username = userData.username;

        const result = await this.usersCollection().updateOne(
            { userId: userData.id },
            { $set: fields },
            { upsert: true }
        );
        if (result?.acknowledged) {
            const cacheKey = `User:${userData.id}`;
            this.cache.set(cacheKey, fields, this.ttlUserDataMs);
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
            const updateData = { ...chatSettingsFromDB, ...chatSettings };
            await this.chatSettingsCollection().updateOne({ chatId }, { $set: updateData });
            const cacheKey = `chatSettings:${chatId}`;
            this.cache.set(cacheKey, updateData, this.ttlChatSettingsMs);
            return updateData;
        } else if (typeof fnMakeChatSettings === 'function') {
            const updateData = { ...await fnMakeChatSettings(), ...chatSettings };
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

