const loadEnvConfig = require('./config');
loadEnvConfig();
const {str2params, isTrue, date2int, date2text, getStatusByAction, textMarkdownNormalize, extractUserTitle} = require('./utils');
const { MongoClient, ObjectId } = require('mongodb');

const mongoClient = new MongoClient(process.env.PADEL_MONGO_URI);
let db;
const gamesCollection = () => db.collection('games');

const start = async () => {
    await mongoClient.connect();
    const dbName = 'padel_bot';//process.env.PADEL_DB_NAME;
    db = mongoClient.db(dbName);
    console.log(`Connected to MongoDB (db ${dbName})`);

    let dateStart = new Date().startOfDay(), dateEnd = new Date().endOfDay();
    const games = await gamesCollection().find(
        {isActive: true, date: {$gte: dateStart, $lte: dateEnd}}
    ).toArray();
    console.log(games);
}

start();