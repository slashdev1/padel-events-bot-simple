/*const dotenv = require('dotenv');
const env = process.env.NODE_ENV || 'development';
switch (env) {
    case 'development':
        dotenv.config({ path: '.env.development' });
        break;
    case 'test':
        dotenv.config({ path: '.env.test' });
        break;
    case 'staging':
        dotenv.config({ path: '.env.staging' });
        break;
    case 'production':
        dotenv.config({ path: '.env.production' });
        break;
    default:
        throw new Error(`Unknown environment: ${env}`);
}*/
const loadEnvConfig = require('./config');
loadEnvConfig();

const {str2params, date2int, date2text, getStatusByAction, textMarkdownNormalize, extractUserTitle} = require('./utils');

const { Telegraf, Markup } = require('telegraf');
const { MongoClient, ObjectId } = require('mongodb');
/*const express = require('express');

const app = express()
const port = process.env.PORT;

app.get('/', (req, res) => {
    res.send(`Bot is running! Follow to ${botUrl}`);
})

app.listen(port, () => {
    console.log(`Express app listening on port ${port}`);
})*/
const {express, updateExtra} = require('./express');
express(process.env.PORT);

const bot = new Telegraf(process.env.PADEL_BOT_TOKEN);
const mongoClient = new MongoClient(process.env.PADEL_MONGO_URI);
let db;
//let superAdminId;
let botName;
let botUrl;
const botCommands = {
    'add_game': { description: 'Cтворює гру.', example: 'Вкажіть назву гри, дату та кількість гравців. Приклад: /add_game "Падел матч вт 19-21" 2025-03-25 8' },
    'active_games': { description: 'Показує перелік активних ігор, на які записувався ігрок.' }
};

(async () => {
    await mongoClient.connect();
    const dbName = process.env.PADEL_DB_NAME;
    db = mongoClient.db(dbName);
    console.log(`Connected to MongoDB (db ${dbName})`);
    superAdminId = (await globalSettingsCollection().findOne())?.superAdminId;
    bot.launch(() => {
        console.log('Bot is running!');
        bot.telegram.getMe().then(data => {
            botName = data.username;
            botUrl = `https://t.me/${botName}`;
            updateExtra({botName, botUrl});
            console.log(botName, botUrl);
        });
    });

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
})();

const gamesCollection = () => db.collection('games');
const globalSettingsCollection = () => db.collection('globalSettings');
const chatSettingsCollection = () => db.collection('chatSettings');

/*const str2params = (str) => str.match(/\\?.|^$/g).reduce((p, c) => {
    if(c === '"'){
        p.quote ^= 1;
    }else if(!p.quote && c === ' '){
        p.a.push('');
    }else{
        p.a[p.a.length-1] += c.replace(/\\(.)/,"$1");
    }
    return  p;
}, {a: ['']}).a;

const date2int = (date) => (typeof date === 'string' ? Date.parse(date) : (date instanceof Date ? date.getTime() : +date)) || 0;
const date2text = (date) => {
    let int = date2int(date);
    if (!int) return '';
    return new Date(int).toLocaleDateString('uk-UA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
};*/

bot.command('help', async (ctx) => {
    ctx.reply('👾 Список підтримуємих команд:\n' +
        Object.keys(botCommands).map(key => {
            let cmd = botCommands[key];
            return `    /${key} - ${cmd.description} ${cmd.example || ''}`;
        }).join('\n') +
        '\n\n💡 Користуватись ботом дуже просто:\n    1. Додайте бота до групи або каналу\n    2. І ось ви вже можете використовувути вишезазначені команди'
    );
});

bot.command('add_game', async (ctx) => {
    const chatId = ctx.chat.id;
    let [cmdName, ...args] = str2params(ctx.message.text);
    cmdName = cmdName.slice(1);
    //if (superAdminId !== ctx.from.id) {
        let chatSettings = await chatSettingsCollection().findOne({ chatId });
        if (!chatSettings) {
            chatSettings = {
                chatId,
                chatName: ctx.chat.title,
                allMembersAreAdministrators: ctx.chat.all_members_are_administrators,
                level: 'free',
                reminders: [],
                admins: [],
                permissions: [/* { command, appliesTo: ("all", "admins", "users"), users: []} */],
                features: [/* { feature } */]
            }
            if (!chatSettings.allMembersAreAdministrators) {
                const admins = await bot.telegram.getChatAdministrators(chatId);
                if (!admins || !admins.length) {
                    chatSettings.admins = admins.map(adm => {
                        return {
                            id: adm.user.id,
                            name: extractUserTitle(adm.user)//adm.user.username ? '@' + adm.user.username : (adm.user.first_name + ' ' + (adm.user.last_name || '')).trim()
                        }
                    });
                };
            }
            await chatSettingsCollection().insertOne(chatSettings);
        }
        const cmdPermission = chatSettings.permissions.find(elem => elem.command === cmdName);
        if (cmdPermission) {
            let users = [];
            if      (cmdPermission.appliesTo === 'all') users = undefined;
            else if (cmdPermission.appliesTo === 'admins') users = chatSettings.admins;
            else if (cmdPermission.appliesTo === 'users') users = cmdPermission.users;
            if (users && !users.some(usr => usr.id === ctx.from.id)) {
                return ctx.reply('⚠️ У вас немає повноважень на використання цієї команди.');
            };
        }
    //}

    const creatorId = ctx.from.id;
    const creatorName = extractUserTitle(ctx.from, false); //(ctx.from.first_name + ' ' + (ctx.from.last_name || '')).trim();
    if (args.length < 3) return ctx.reply('Передана некоректа кількість параметрів. ' + botCommands[cmdName].example);
    let parsedDate = Date.parse(args[1]);
    if (!parsedDate) return ctx.reply('Дату треба вказувати у такому форматі: 2025-03-25 або "2025-03-25 11:00"');
    let maxPlayers = parseInt(args[2]);
    if (!maxPlayers || maxPlayers <= 0) return ctx.reply('Кількість ігроків повинно бути числом більше 0.');

    const game = {
        chatId,
        creatorId,
        creatorName,
        name: args[0],
        date: new Date(parsedDate),
        maxPlayers: parseInt(args[2]),
        players: [],
        isActive: true
    };
    const result = await gamesCollection().insertOne(game);
    const gameId = result.insertedId;
    const message = await writeGameMessage(ctx, game, gameId);
    await gamesCollection().updateOne({ _id: gameId }, { $set: { messageId: message.message_id } });
});

bot.command('active_games', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const filter = { isActive: true };
    let where = '';
    if (chatId < 0) {
        filter.chatId = chatId;
        where = ' у ' + ctx.chat.title;
    }
    const games = await gamesCollection().find(filter).toArray();
    let response = `Немає активних ігор${where}.`;
    if (games.length) {
        const lines = [];
        games.forEach(game => {
            let gameDate = date2int(game.date);
            if (gameDate && gameDate + 86400000 < Date.now()) return;
            let status = ' Ще не має статусу';
            let ind = game.players.filter(p => p.status === 'joined').sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).findIndex(p => p.id === userId);
            if (ind >= 0 && ind < game.maxPlayers) status = '✅ Йду';
            if (ind >= 0 && ind >= game.maxPlayers) status = '⏳ У черзі';
            if (game.players.some(p => p.id === userId && p.status === 'pending')) status = '❓ Думаю';
            if (game.players.some(p => p.id === userId && p.status === 'declined')) status = '❌ Не йду';
            lines.push({gameDate, text: `📅 **${game.name} (${date2text(game.date)})** - ${status}`});
        });
        if (lines.length) {
            lines.sort((a, b) => (a.gameDate || 0) - (b.gameDate || 0));
            response = `📋 **Активні ігри${where}:**\n\n` + lines.map(elem => elem.text).join(`\n`);
        }
    }
    try {
        await bot.telegram.sendMessage(userId, response, { parse_mode: 'Markdown' });
    } catch (error) {
        ctx.reply(`Для отримання повідомлень від бота перейдіть на нього ${botUrl} та натисніть Start.`);
    }

});

bot.action(/^join_(.*)$/, async (ctx) => updateGameStatus(ctx, 'join'));
bot.action(/^pending_(.*)$/, async (ctx) => updateGameStatus(ctx, 'pending'));
bot.action(/^decline_(.*)$/, async (ctx) => updateGameStatus(ctx, 'decline'));

async function updateGameStatus(ctx, action) {
    const gameId = ctx.match[1];
    const userId = ctx.from.id;
    const username = extractUserTitle(ctx.from);//ctx.from.username ? '@' + ctx.from.username : (ctx.from.first_name + ' ' + (ctx.from.last_name || '')).trim();
    const timestamp = new Date();//ctx.update.callback_query.date * 1000);

    const game = await gamesCollection().findOne({ _id: ObjectId.createFromHexString(gameId) });
    if (!game || !game.isActive) return;

    const newStatus = getStatusByAction(action);
    const playerInd = game.players.findIndex(p => p.id === userId);
    if (playerInd >= 0) {
        if (game.players[playerInd].status === newStatus) {
            // status not changed
            return;
        }
        game.players.splice(playerInd, 1);
    }

    game.players.push({ id: userId, name: username, status: newStatus, timestamp });
    game.players.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    await gamesCollection().updateOne({ _id: game._id }, { $set: { players: game.players } });

    updateGameMessage(game, gameId);
}

//const textMarkdownNormalize = (text) => text.replace(/(?<!(_|\\))_(?!_)/g, '\\_');

const buildTextMessage = (game) => {
    const players = game.players || [];
    const m = (username) => (username[0] != '@' && username.indexOf(' ') == -1 ? '@' : '') + username; // support values of usernames for older versions DB
    return textMarkdownNormalize(
        `📅 **${game.name} (${date2text(game.date)})**\n\n` +
        `👥 Кількість учасників ${players.filter(p => p.status === 'joined').length}/${game.maxPlayers}\n` +
        `✅ Йдуть: ${players.filter(p => p.status === 'joined').slice(0, game.maxPlayers).map(p => `${m(p.name)}`).join(', ') || '-'}\n` +
        `⏳ У черзі: ${players.filter(p => p.status === 'joined').slice(game.maxPlayers).map(p => `${m(p.name)}`).join(', ') || '-'}\n` +
        `❓ Думають: ${players.filter(p => p.status === 'pending').map(p => `${m(p.name)}`).join(', ') || '-'}\n` +
        `❌ Не йдуть: ${players.filter(p => p.status === 'declined').map(p => `${m(p.name)}`).join(', ') || '-'}\n\n` +
        `Опубліковано ${game.creatorName}`
    );
}

const buildMarkup = (gameId) => Markup.inlineKeyboard([
    [Markup.button.callback('✅ Йду', `join_${gameId}`)],
    [Markup.button.callback('❓ Треба подумати', `pending_${gameId}`)],
    [Markup.button.callback('❌ Не йду', `decline_${gameId}`)]
]);

async function updateGameMessage(game, gameId) {
    if (!game) return;

    try {
        return await bot.telegram.editMessageText(game.chatId, game.messageId, null, buildTextMessage(game), { parse_mode: 'Markdown', ...buildMarkup(gameId) });
    } catch (error) {
        console.error(error);
    }
}

async function writeGameMessage(ctx, game, gameId) {
    if (!game) return;

    return await ctx.reply(buildTextMessage(game), { parse_mode: 'Markdown', ...buildMarkup(gameId) });
}
/*
// Start the bot
const startBot = () => {

};

startBot();
*/