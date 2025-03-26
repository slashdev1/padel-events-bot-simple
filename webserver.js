class Webserver {
    constructor(uri, dbName) {
        // this.client = new MongoClient(uri);
        // this.dbName = dbName;
        // this.db = null;
    }

    async connect() {
        // await this.client.connect();
        // this.db = this.client.db(this.dbName);
        // console.log(`Connected to MongoDB (db ${this.dbName})`);

        // // Enable graceful stop
        // process.once('SIGINT', () => this.disconnect());
        // process.once('SIGTERM', () => this.disconnect());
    }
}

module.exports = Webserver;