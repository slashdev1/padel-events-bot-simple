class Database {
    constructor(uri, dbName) {
        this.client = new MongoClient(uri);
        this.dbName = dbName;
        this.db = null;
    }

    async connect() {
        await this.client.connect();
        this.db = this.client.db(this.dbName);
        console.log(`Connected to MongoDB (db ${this.dbName})`);

        // Enable graceful stop
        process.once('SIGINT', () => this.disconnect());
        process.once('SIGTERM', () => this.disconnect());
    }

    async disconnect() {
        await this.client.close();
    }

    // Collection getters
    games() { return this.db.collection('games'); }
    users() { return this.db.collection('users'); }
    globalSettings() { return this.db.collection('globalSettings'); }
    chatSettings() { return this.db.collection('chatSettings'); }
/*
    // User operations
    async updateUser(userData) {
        const fields = {};
        if ('id' in userData)               fields.userId = userData.id;
        if ('started' in userData)          fields.started = userData.started;
        if ('startedTimestamp' in userData) fields.startedTimestamp = userData.startedTimestamp;
        if ('first_name' in userData)       fields.firstName = userData.first_name;
        if ('last_name' in userData)        fields.lastName = userData.last_name;
        if ('username' in userData)         fields.username = userData.username;

        return await this.users().updateOne(
            { userId: userData.id },
            { $set: fields },
            { upsert: true }
        );
    }

    async findUser(userId) {
        return await this.users().findOne({ userId });
    }

    // Game operations
    async createGame(gameData) {
        return await this.games().insertOne(gameData);
    }

    async updateGamePlayers(gameId, players) {
        return await this.games().updateOne(
            { _id: gameId },
            { $set: { players } }
        );
    }

    async findActiveGames(filter = {}) {
        return await this.games().find({ isActive: true, ...filter }).toArray();
    }

    async deactivateOldGames(date) {
        return await this.games().updateMany(
            { $and: [{isActive: true}, {date: {$lte : date}}] },
            { $set: { isActive: false } }
        );
    }

    // Chat settings operations
    async getChatSettings(chatId) {
        return await this.chatSettings().findOne({ chatId });
    }

    async createChatSettings(settings) {
        return await this.chatSettings().insertOne(settings);
    }*/
}

module.exports = Database;