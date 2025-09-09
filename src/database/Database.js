const { MongoClient, ObjectId } = require('mongodb');
const Cache = require('../cache/Cache');

class Database {
    constructor(mongoUri, dbName) {
        this.mongoUri = mongoUri;
        this.dbName = dbName;
        this.client = new MongoClient(mongoUri);
        this.db = null;

        // Generic TTL cache for database lookups
        this.cache = new Cache({
            defaultTtlMs: process.env.CACHE_DEFAULT_TTL_MS,
            cleanupIntervalMs: process.env.CACHE_CLEANUP_INTERVAL_MS
        });

        // Optional per-key TTL overrides
        const defaultTtlMs = 60 * 1000;
        this.ttlChatSettingsMs = Number(process.env.CACHE_TTL_CHAT_SETTINGS_MS || defaultTtlMs);
        this.ttlGlobalSettingsMs = Number(process.env.CACHE_TTL_GLOBAL_SETTINGS_MS || defaultTtlMs);
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
        return await this.usersCollection().findOne({ userId });
    }

    async updateUser(userData) {
        const fields = {};
        if ('id' in userData) fields.userId = userData.id;
        if ('started' in userData) fields.started = userData.started;
        if ('startedTimestamp' in userData) fields.startedTimestamp = userData.startedTimestamp;
        if ('first_name' in userData) fields.firstName = userData.first_name;
        if ('last_name' in userData) fields.lastName = userData.last_name;
        if ('username' in userData) fields.username = userData.username;

        return await this.usersCollection().updateOne(
            { userId: userData.id },
            { $set: fields },
            { upsert: true }
        );
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
        if (chatSettings && chatSettings.chatId != null) {
            const cacheKey = `chatSettings:${chatSettings.chatId}`;
            this.cache.set(cacheKey, chatSettings, this.ttlChatSettingsMs);
        }
        return result;
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
}

module.exports = Database;

