require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { MongoClient, ObjectId } = require('mongodb');
const express = require('express');

const app = express()
const port = process.env.PORT;

app.get('/', (req, res) => {
    res.send(`Bot is running! Follow to ${botUrl}`);
})

app.listen(port, () => {
    console.log(`Express app listening on port ${port}`);
})

const bot = new Telegraf(process.env.PADEL_BOT_TOKEN);
const mongoClient = new MongoClient(process.env.PADEL_MONGO_URI);
let db;
let superAdminId;
let botName;
let botUrl;

(async () => {
    await mongoClient.connect();
    db = mongoClient.db('padel_bot');
    console.log('Connected to MongoDB');
    superAdminId = (await globalSettingsCollection().findOne()).superAdminId;
    bot.launch(() => {
        console.log('Bot is running!');
        bot.telegram.getMe().then(data => console.log(botName = data.username, botUrl = `https://t.me/${botName}`));
    });

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
})();

const gamesCollection = () => db.collection('games');
const globalSettingsCollection = () => db.collection('globalSettings');
const chatSettingsCollection = () => db.collection('chatSettings');

const str2params = (str) => str.match(/\\?.|^$/g).reduce((p, c) => {
    if(c === '"'){
        p.quote ^= 1;
    }else if(!p.quote && c === ' '){
        p.a.push('');
    }else{
        p.a[p.a.length-1] += c.replace(/\\(.)/,"$1");
    }
    return  p;
}, {a: ['']}).a;

bot.command('add_game', async (ctx) => {
    const chatId = ctx.chat.id;
    //if (superAdminId !== ctx.from.id) {
        const chatSettings = await chatSettingsCollection().findOne({ chatId });
        if (!chatSettings) {
            chatSettings = {
                chatId,
                chatName: ctx.chat.title,
                allMembersAreAdministrators: ctx.chat.all_members_are_administrators,
                level: 'free',
                reminders: [],
                admins: [],
                permissions: [/* { command, appliesTo: ("all", "admins", "users"), users: []} */]
            }
            if (!chatSettings.allMembersAreAdministrators) {
                const admins = await bot.telegram.getChatAdministrators(chatId);
                if (!admins || !admins.length) {
                    chatSettings.admins = admins.map(adm => {
                        return {
                            id: adm.user.id,
                            name: adm.user.username || (adm.user.first_name + ' ' + adm.user.last_name).trim()
                        }
                    });
                };
            }
            await chatSettingsCollection().insertOne(chatSettings);
        }
        const cmdPermission = chatSettings.permissions.find(elem => elem.command === 'add_game');
        if (cmdPermission) {
            let users = [];
            if      (cmdPermission.appliesTo === 'all') users = undefined;
            else if (cmdPermission.appliesTo === 'admins') users = chatSettings.admins;
            else if (cmdPermission.appliesTo === 'users') users = cmdPermission.users;
            if (users && !users.some(usr => usr.id === ctx.from.id)) {
                return ctx.reply('⚠️ Цю команду може використовувати лише адміністратор.');
            };
        }
    //}

    const creatorId = ctx.from.id;
    const creatorName = (ctx.from.first_name + ' ' + ctx.from.last_name).trim();
    const args = str2params(ctx.message.text).slice(1);
    if (args.length < 3) return ctx.reply('Вкажіть назву гри, дату та кількість гравців. Приклад: /add_game Падел-матч 2025-03-25 8');

    const game = {
        chatId,
        creatorId,
        creatorName,
        name: args[0],
        date: args[1],
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
    const games = await gamesCollection().find({ chatId, isActive: true }).toArray();
    let response = 'Немає активних ігор.';
    if (games.length) {
        const lines = [];
        games.forEach(game => {
            let gameDate = Date.parse(game.date);
            if (gameDate && gameDate + 86400000 < Date.now()) return;
            let status = '-';
            let ind = game.players.filter(p => p.status === 'joined').sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).findIndex(p => p.id === userId);
            if (ind >= 0 && ind < game.maxPlayers) status = '✅ Йду';
            if (ind >= 0 && ind >= game.maxPlayers) status = '⏳ У черзі';
            if (game.players.some(p => p.id === userId && p.status === 'pending')) status = '❓ Думаю';
            if (game.players.some(p => p.id === userId && p.status === 'declined')) status = '❌ Не йду';
            lines.push({gameDate, text: `📅 **${game.name} (${game.date})** - ${status}`});
        });
        if (lines.length) {
            lines.sort((a, b) => (a.gameDate || 0) - (b.gameDate || 0));
            response = '📋 **Активні ігри:**\n\n' + lines.map(elem => elem.text).join(`\n`);
        }
    }
    try {
        await bot.telegram.sendMessage(userId, response);
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
    const username = ctx.from.username || (ctx.from.first_name + ' ' + ctx.from.last_name).trim();
    const timestamp = new Date();//ctx.update.callback_query.date * 1000);

    const game = await gamesCollection().findOne({ _id: ObjectId.createFromHexString(gameId) });
    if (!game || !game.isActive) return;

    game.players = game.players.filter(p => p.id !== userId);

    if (action === 'join')    game.players.push({ id: userId, name: username, status: 'joined',   timestamp });
    if (action === 'pending') game.players.push({ id: userId, name: username, status: 'pending',  timestamp });
    if (action === 'decline') game.players.push({ id: userId, name: username, status: 'declined', timestamp });

    game.players.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    await gamesCollection().updateOne({ _id: game._id }, { $set: { players: game.players } });

    updateGameMessage(game, gameId);
}

const buildTextMessage = (game) => {
    const players = game.players || [];
    return `📅 **${game.name} (${game.date})**\n\n` +
        `👥 Кількість учасників ${players.filter(p => p.status === 'joined').length}/${game.maxPlayers}\n` +
        `✅ Йдуть: ${players.filter(p => p.status === 'joined').slice(0, game.maxPlayers).map(p => `@${p.name}`).join(', ') || '-'}\n` +
        `⏳ У черзі: ${players.filter(p => p.status === 'joined').slice(game.maxPlayers).map(p => `@${p.name}`).join(', ') || '-'}\n` +
        `❓ Думають: ${players.filter(p => p.status === 'pending').map(p => `@${p.name}`).join(', ') || '-'}\n` +
        `❌ Не йдуть: ${players.filter(p => p.status === 'declined').map(p => `@${p.name}`).join(', ') || '-'}\n\n` +
        `Опубліковано ${game.creatorName}`;
}

const buildMarkup = (gameId) => Markup.inlineKeyboard([
    [Markup.button.callback('✅ Йду', `join_${gameId}`)],
    [Markup.button.callback('❓ Треба подумати', `pending_${gameId}`)],
    [Markup.button.callback('❌ Не йду', `decline_${gameId}`)]
]);

async function updateGameMessage(game, gameId) {
    if (!game) return;

    try {
        return await bot.telegram.editMessageText(game.chatId, game.messageId, null, buildTextMessage(game), buildMarkup(gameId));
    } catch (error) {
        console.error(error);
    }
}

async function writeGameMessage(ctx, game, gameId) {
    if (!game) return;

    return await ctx.reply(buildTextMessage(game), buildMarkup(gameId));
}
