const { MongoClient, ObjectId } = require('mongodb');
const Cache = require('./Cache');
const Config = require('./Config');
const { sleep, arraysEqualUnordered } = require('../helpers/utils');

const GameStatus = Object.freeze({
    ACTIVE: "active",      // гра відкрита, показуємо всі кнопки
    INACTIVE: "inactive",  // гра закрита вручну, показуємо лише "Відкрити гру"
    EXPIRED: "expired",    // гра закрита механізмом deactivateExpiredGames, не показуємо кнопки
    DELETED: "deleted"
});

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
        this.ttlGameDataMs = Number(config.cacheTtlGameData || defaultTtlMs);
    }

    setBot(bot) {
        this.bot = bot;
    }

    async connect() {
        await this.client.connect();
        this.db = this.client.db(this.dbName);
        console.log(`Connected to MongoDB (db ${this.dbName})`);
        await this.ensureGamePlayersIndexes();

        // const chatSettings = await this.chatSettingsCollection().findOne({ chatId: -5175576414 })
        // console.log(JSON.stringify(chatSettings));
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

    notificationsCollection() {
        return this.db.collection('notifications');
    }

    gamePlayersCollection() {
        return this.db.collection('gamePlayers');
    }

    _id(id) {
        return typeof id === 'string' ? ObjectId.createFromHexString(id) : id;
    }

    _isDuplicateKeyError(err) {
        return err && (err.code === 11000 || err.code === 11001);
    }

    _publicGamePlayer(doc) {
        if (!doc) return null;
        return {
            id: doc.id,
            name: doc.name,
            fullName: doc.fullName,
            extraPlayer: doc.extraPlayer ?? 0,
            status: doc.status,
            timestamp: doc.timestamp,
            subgameIndex: doc.subgameIndex ?? 0
        };
    }

    async ensureGamePlayersIndexes() {
        if (!this.db) return;
        const coll = this.gamePlayersCollection();
        await coll.createIndex(
            { gameId: 1, id: 1, extraPlayer: 1, subgameIndex: 1 },
            { unique: true, name: 'gamePlayer_unique_slot' }
        );
        await coll.createIndex({ gameId: 1, timestamp: 1 }, { name: 'gamePlayer_by_game_time' });
    }

    async getGamePlayers(gameId) {
        const oid = this._id(gameId);
        const rows = await this.gamePlayersCollection()
            .find({ gameId: oid })
            .sort({ timestamp: 1 })
            .toArray();
        return rows.map((d) => this._publicGamePlayer(d));
    }

    getGameCacheKey(gameId) {
        return `Game:${String(gameId)}`;
    }

    invalidateGameCache(gameId) {
        this.cache.delete(this.getGameCacheKey(gameId));
    }

    async insertGamePlayer(gameId, player) {
        const oid = this._id(gameId);
        const doc = {
            gameId: oid,
            id: player.id,
            name: player.name,
            fullName: player.fullName,
            extraPlayer: player.extraPlayer ?? 0,
            status: player.status,
            timestamp: player.timestamp instanceof Date ? player.timestamp : new Date(),
            subgameIndex: player.subgameIndex ?? 0
        };
        try {
            await this.gamePlayersCollection().insertOne(doc);
            return { ok: true };
        } catch (err) {
            if (this._isDuplicateKeyError(err)) return { ok: false, duplicate: true };
            throw err;
        }
    }

    async updateGamePlayerSlot(gameId, slot, setFields) {
        const oid = this._id(gameId);
        await this.gamePlayersCollection().updateOne(
            {
                gameId: oid,
                id: slot.id,
                extraPlayer: slot.extraPlayer ?? 0,
                subgameIndex: slot.subgameIndex ?? 0
            },
            { $set: setFields }
        );
    }

    async deleteGamePlayerSlot(gameId, slot) {
        const oid = this._id(gameId);
        await this.gamePlayersCollection().deleteOne({
            gameId: oid,
            id: slot.id,
            extraPlayer: slot.extraPlayer ?? 0,
            subgameIndex: slot.subgameIndex ?? 0
        });
    }

    async kickUserFromAllGameSlots(gameId, userId) {
        const oid = this._id(gameId);
        await this.gamePlayersCollection().updateMany(
            { gameId: oid, id: userId },
            { $set: { status: 'kicked' } }
        );
    }

    // Game operations
    async createGame(gameData) {
        const doc = { ...gameData };
        delete doc.players;
        doc.createdDate = new Date;
        const result = await this.gamesCollection().insertOne(doc);
        gameData._id = result.insertedId;
        this.invalidateGameCache(result.insertedId);
        return result.insertedId;
    }

    async getGame(gameId) {
        const oid = this._id(gameId);
        const cacheKey = this.getGameCacheKey(oid);
        return await this.cache.getOrSet(
            cacheKey,
            async () => {
                return await this.gamesCollection().findOne({ _id: oid });
            },
            this.ttlGameDataMs
        );
    }

    async getGameWithPlayers(gameId) {
        const game = await this.getGame(gameId);
        if (!game) return null;
        game.players = await this.getGamePlayers(game._id);
        return game;
    }

    async updateGame(gameId, updateData) {
        const payload = { ...updateData };
        delete payload.players;
        payload.updatedDate = new Date();
        const result = await this.gamesCollection().updateOne(
            { _id: this._id(gameId)},
            { $set: payload }
        );
        this.invalidateGameCache(gameId);
        return result;
    }

    async deactivateGame(gameId) {
        const result = await this.gamesCollection().updateOne(
            { _id: this._id(gameId) },
            { $set: { /*isActive: false*/ status: GameStatus.DELETED } }
        );
        this.invalidateGameCache(gameId);
        return result;
    }

    async deactivateExpiredGames() {
        const now = new Date();
        const startOfDate = now.startOfDay();
        // console.log(now, 'Deactivation...');

        const filter = {
            //isActive: true,
            status: GameStatus.ACTIVE,
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

        const gamesToDeactivate = await this.findGames(filter);
        if (gamesToDeactivate.length > 0) {
            const result = await this.gamesCollection().updateMany(filter, { $set: { /*isActive: false*/status: GameStatus.EXPIRED } });
            if (result.modifiedCount) {
                console.log(`Deactivated ${result.modifiedCount} games:`);

                const gameIds = gamesToDeactivate.map(g => g._id);
                const players = await this.gamePlayersCollection()
                    .find({ gameId: { $in: gameIds } })
                    .sort({ timestamp: 1 })
                    .toArray();
                const playersByGame = players.reduce((acc, p) => {
                    const gid = p.gameId.toHexString();
                    if (!acc[gid]) acc[gid] = [];
                    acc[gid].push(this._publicGamePlayer(p));
                    return acc;
                }, {});

                for (const game of gamesToDeactivate) {
                    try {
                        //game.isActive = false;
                        game.status = GameStatus.EXPIRED;
                        const gameId = game._id.toHexString();
                        console.log(`    id=${gameId}, ${game.name}`);
                        game.players = playersByGame[gameId] || [];
                        if (this.bot?.updateGameMessage) {
                            await this.bot.updateGameMessage(game, gameId);
                        }
                    } finally {
                        await sleep(100);
                    }
                }
            }
        }
    }

    async findGames(filter) {
        return await this.gamesCollection().aggregate([
            {
                $match: filter
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
                    status: 1,
                    createdDate: 1,
                    createdByName: 1,
                    subgames: 1,
                    timezone: '$chatSettings.timezone',
                    notificationTerms: '$chatSettings.notificationTerms',
                    license: '$chatSettings.license'
                }
            }
        ]).toArray();
    }

    async getActiveGamesWithChatSettings(filter) {
        return await this.gamesCollection().aggregate([
            {
                $match: { ...filter, /*isActive: true*/status: GameStatus.ACTIVE }
            },
            // 1. Приєднуємо налаштування чату
            {
                $lookup: {
                    from: 'chatSettings',
                    localField: 'chatId',
                    foreignField: 'chatId',
                    as: 'chatSettings'
                }
            },
            { $unwind: { path: '$chatSettings', preserveNullAndEmptyArrays: true } },

            // 2. Приєднуємо ТІЛЬКИ активні сповіщення для конкретної гри
            {
                $lookup: {
                    from: 'notifications',
                    let: { game_id: '$_id' }, // Створюємо змінну з ID гри
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        // Порівнюємо gameId (якщо він у вас збережений як рядок, додайте конвертацію)
                                        { $eq: ['$gameId', '$$game_id'] },
                                        { $eq: [/*'$isActive', true*/'$status', GameStatus.ACTIVE] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: 'notifications'
                }
            },

            {
                $lookup: {
                    from: 'gamePlayers',
                    let: { gid: '$_id' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$gameId', '$$gid'] } } },
                        { $sort: { timestamp: 1 } },
                        {
                            $project: {
                                _id: 0,
                                id: 1,
                                name: 1,
                                fullName: 1,
                                extraPlayer: 1,
                                status: 1,
                                timestamp: 1,
                                subgameIndex: 1
                            }
                        }
                    ],
                    as: 'playersFromColl'
                }
            },

            // 3. Формуємо фінальний об'єкт
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
                    players: { $ifNull: ['$playersFromColl', []] },
                    subgames: 1,
                    timezone: '$chatSettings.settings.timezone',
                    notificationTerms: '$chatSettings.settings.notificationTerms',
                    license: '$chatSettings.license',
                    notifications: 1
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
        // console.log('getChatSettings', chatId);
        return await this.cache.getOrSet(
            cacheKey,
            async () => {
                const chatSettings = await this.chatSettingsCollection().findOne({ chatId });
                // console.log('getChatSettings/async ()', chatId, chatSettings, this.bot);
                if (chatSettings && this.bot) {
                    try {
                        const adminsRaw = await this.bot.getChatAdmins(chatId);
                        // console.log(adminsRaw);
                        const admins = adminsRaw.map(item => { return { ...item.user, status: item.status }; });
                        const isUpdateNeeded = !arraysEqualUnordered(admins, chatSettings.admins || []);
                        // console.log(admins);
                        chatSettings.admins = admins;
                        if (isUpdateNeeded)
                            this.updateChatSettings({ chatId, admins: admins});
                    } catch (error) {
                        console.error(error);
                    }
                }
                return chatSettings;
            },
            this.ttlChatSettingsMs
        );
    }

    async createChatSettings(chatSettings) {
        const result = await this.chatSettingsCollection().insertOne(chatSettings);
        // console.log('createChatSettings', chatSettings);
        if (chatSettings && chatSettings.chatId) {
            const cacheKey = `chatSettings:${chatSettings.chatId}`;
            this.cache.set(cacheKey, chatSettings, this.ttlChatSettingsMs);
        }
        return result;
    }

    async updateChatSettings(chatSettings, fnMakeChatSettings) {
        const { chatId } = chatSettings;
        const chatSettingsFromDB = await this.getChatSettings(chatId);
        // console.log('updateChatSettings', chatId, chatSettings, chatSettingsFromDB, typeof fnMakeChatSettings);
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

    async updateGlobalSettings(fields) {
        const result = await this.globalSettingsCollection().updateOne(
            {},
            { $set: fields},
            { upsert: true }
        );
        this.cache.delete('globalSettings');
        return result;
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

    async createNotification(gameId, userId)  {
        return await this.notificationsCollection().findOneAndUpdate(
            {
                gameId: this._id(gameId),
                userId: userId
            },
            [
                {
                    $set: {
                        isActive: {
                            $cond: {
                                if: { $eq: [/*'$isActive', true*/'$status', GameStatus.ACTIVE] },
                                then: false,
                                else: true
                            }
                        },
                        updatedDate: new Date()
                    }
                }
            ],
            {
                upsert: true,
                returnDocument: 'after' // ВАЖЛИВО: кажемо повернути документ ПІСЛЯ оновлення
            }
        );
    }

    // Auxiliary function
    async getSettingsByChatId(chatId) {
        if (chatId < 0) {
            const chatSettings = await this.getChatSettings(chatId) || {};
            return chatSettings.settings || {};
        }
        const user = await this.getUserFromDB(chatId);
        return user.settings || {};
    }
}

module.exports = { Database, GameStatus };