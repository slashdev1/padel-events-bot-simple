const loadEnvConfig = require('./env');
loadEnvConfig();
const {str2params, isTrue, date2int, date2text, parseDate, getStatusByAction, textMarkdownNormalize, extractUserTitle, occurrences} = require('./utils');
const cron = require('node-cron');
const { Telegraf, Markup } = require('telegraf');
const { MongoClient, ObjectId } = require('mongodb');
const package = require('./package.json');
const botCommands = require('./commands-descriptions.json');
const emoji = require('./emoji.json');
const bot = new Telegraf(process.env.PADEL_BOT_TOKEN);
const mongoClient = new MongoClient(process.env.PADEL_MONGO_URI);
let db;
//let superAdminId;
let botName;
let botUrl;
let express, updateExtra;

const start = async () => {
    console.log(`Date on server ${new Date()}`);
    await mongoClient.connect();
    const dbName = process.env.PADEL_DB_NAME;
    db = mongoClient.db(dbName);
    console.log(`Connected to MongoDB (db ${dbName})`);

    //superAdminId = (await globalSettingsCollection().findOne())?.superAdminId;

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

    const onLaunch = () => {
        console.log('Bot is running!');
        //bot.telegram.getMe().then(data => {
            data = bot.botInfo;
            botName = data.username;
            botUrl = `https://t.me/${botName}`;
            updateExtra({botName, botUrl});
            console.log(botName, botUrl);
        //});
    };

    const config = {
        allowed_updates: [
            'update_id',
            'message',
            'edited_message',
            'channel_post',
            'edited_channel_post',
            'inline_query',
            'chosen_inline_result',
            'callback_query',
            'shipping_query',
            'pre_checkout_query',
            'poll',
            'poll_answer',
            'my_chat_member',
            'chat_member',
            'chat_join_request',
        ]
    }
    if (isTrue(process.env.USE_EXPRESS)) {
        express = require('./express').express;
        updateExtra = require('./express').updateExtra;
        const app = express(process.env.PORT);
        if (!isTrue(process.env.PADEL_BOT_USE_PULLING)) {
            bot.botInfo = await bot.telegram.getMe();
            onLaunch();
            bot.webhookServer = null; // important to avoid: throw new Error('Bot is not running!');
            config.domain = process.env.PADEL_BOT_WEBHOOK_DOMAIN;
            app.use(await bot.createWebhook(config));
            return;
        }
    } else
        updateExtra = () => {};


    if (!isTrue(process.env.PADEL_BOT_USE_PULLING)) {
        config.webhook = {
            domain: process.env.PADEL_BOT_WEBHOOK_DOMAIN,
            port: process.env.PADEL_BOT_WEBHOOK_PORT
        };
    }
    bot.launch(config, onLaunch);
};

const gamesCollection = () => db.collection('games');
const usersCollection = () => db.collection('users');
const globalSettingsCollection = () => db.collection('globalSettings');
const chatSettingsCollection = () => db.collection('chatSettings');

bot.command('start', async (ctx) => {
    const user = ctx.from;
    updateUser({...user, started: true, startedTimestamp: new Date()});
    let message = botCommands['start']?.description;
    if (!message) return;
    let tpl = eval('`'+message+'`');
    if (ctx.chat.id < 0)
        bot.telegram.sendMessage(user.id, tpl, { parse_mode: 'Markdown' });
    else
        ctx.reply(tpl);
});

bot.command('help', async (ctx) => {
    ctx.reply('👾 Список команд, що підтримуються:\n' +
        Object.keys(botCommands)
            .filter(key => botCommands[key].isDisplayable !== false)
            .map(key => {
                let cmd = botCommands[key];
                return `    /${key} - ${cmd.description} ${cmd.example || ''}`;
            }).join('\n') + botCommands['help'].extra || ''
    );
});

bot.command('__ver', async (ctx) => {
    replyToUserDirectOrDoNothing(ctx, package.version);
});

bot.command('__time', async (ctx) => {
    const now = new Date();
    replyToUserDirectOrDoNothing(ctx, `Час на сервері:\n${now}\n${now.toISOString()}\n${now.toLocaleString()}`);
});

bot.command('__send_to', async (ctx) => {
    let [_, ...args] = str2params(ctx.message.text);
    replyToUserDirectOrDoNothing({from: {id: parseInt(args[0])}}, args[1]);
});

bot.command('add_game', async (ctx) => {
    const chatId = ctx.chat.id;
    let [cmdName, ...args] = str2params(ctx.message.text);
    cmdName = cmdName.slice(1);

    if (args.length < 3) return ctx.reply(emoji.warn + 'Передана недостатня кількість параметрів. ' + botCommands[cmdName].example);
    if (args.length > 3) return ctx.reply(emoji.warn + 'Передана некоректа кількість параметрів. ' + (occurrences(ctx.message.text, '"') > 2 ? 'Скоріше проблема з використанням подвійних лапок ("). ' : '') + botCommands[cmdName].example);
    const stringDate = args[1];
    const parsedDate = parseDate(stringDate);
    if (!parsedDate) return ctx.reply(emoji.warn + 'Дату треба вказувати у такому форматі: 2025-03-25 або "2025-03-25 11:00"');
    let maxPlayers = parseInt(args[2]);
    if (!maxPlayers || maxPlayers <= 0) return ctx.reply('Кількість ігроків повинно бути числом більше 0.');

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
                            name: extractUserTitle(adm.user)
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
                return ctx.reply(emoji.noaccess + 'У вас немає повноважень на використання цієї команди.');
            };
        }
    //}

    const creatorId = ctx.from.id;
    const creatorName = extractUserTitle(ctx.from, false);

    const game = {
        createdDate: new Date(),
        createdById: creatorId,
        createdByName: creatorName,
        isActive: true,
        chatId,
        creatorId, // deprecated in the nearest future
        creatorName, // deprecated in the nearest future
        name: args[0],
        date: new Date(parsedDate),
        isDateWithoutTime: stringDate.match(/\d+/g).length < 4, // minimal length for successfully converted date (e.g. "2025-03-01 9:")
        maxPlayers: parseInt(args[2]),
        players: []
    };
    const result = await gamesCollection().insertOne(game);
    const gameId = result.insertedId;
    const message = await writeGameMessage(ctx, game, gameId);
    await gamesCollection().updateOne({ _id: gameId }, { $set: { messageId: message.message_id } });
    const replyText = `Ви щойно створили гру "${args[0]}" (id=${gameId}).` + (game.isDateWithoutTime ? '\n\n' + emoji.warn + 'Для того щоб коректно нагадувати та деактивовувати ігри краще зазначати дату ігри разом з часом.' : '');
    replyToUserDirectOrDoNothing(ctx, replyText);
});

bot.command('del_game', async (ctx) => {
    let [_, ...args] = str2params(ctx.message.text);
    const gameId = args[0];
    const game = await gamesCollection().findOne({ _id: ObjectId.createFromHexString(gameId) });
    if (!game || !game.isActive) return;
    await gamesCollection().updateOne({ _id: game._id }, { $set: { isActive: false } });
    try {
        await bot.telegram.deleteMessage(game.chatId, game.messageId);
    } catch (error) {
        //console.error(JSON.stringify(error));
        if (error?.code === 400) {
            // message to delete not found
            //replyWarning(ctx);
            //updateUser({...ctx.from, started: false, startedTimestamp: new Date()});
        } else
            ctx.reply(message);
    }
    const replyText = `Ви щойно видалили гру "${game.name}" (id=${gameId}).`
    replyToUserDirectOrDoNothing(ctx, replyText);
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
    replyToUser(ctx, response);
});

bot.action(/^join_(.*)$/, async (ctx) => updateGameStatus(ctx, 'join'));
bot.action(/^pending_(.*)$/, async (ctx) => updateGameStatus(ctx, 'pending'));
bot.action(/^decline_(.*)$/, async (ctx) => updateGameStatus(ctx, 'decline'));

const replyToUser = async (ctx, message) => {
    const replyWarning = (ctx) => ctx.reply(`Для отримання повідомлень від бота перейдіть на нього ${botUrl} та натисніть Start.`);
    const userId = ctx.from.id;
    const user = await usersCollection().findOne({ userId });
    if (user && user.started) {
        try {
            await bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            //console.error(JSON.stringify(error));
            if (error?.code === 403) {
                replyWarning(ctx);
                updateUser({...ctx.from, started: false, startedTimestamp: new Date()});
            } else
                ctx.reply(message);
        }
    } else
        replyWarning(ctx);
}

const replyToUserDirectOrDoNothing = async (ctx, message) => {
    const userId = ctx.from.id;
    const user = await usersCollection().findOne({ userId });
    let sent = false;
    try {
        await bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
        sent = true;
    } catch (error) {
        //console.error(JSON.stringify(error));
        if (error?.code === 403) {
            updateUser({...ctx.from, started: false, startedTimestamp: new Date()});
            return;
        }
    }
    if (sent && !user?.started) updateUser({...ctx.from, started: true, startedTimestamp: new Date()});
}

const updateUser = (userData) => {
    const fields = {};
    //{...(quantity && { quantity })}
    if ('id' in userData)               fields.userId = userData.id;
    if ('started' in userData)          fields.started = userData.started;
    if ('startedTimestamp' in userData) fields.startedTimestamp = userData.startedTimestamp;
    if ('first_name' in userData)       fields.firstName = userData.first_name;
    if ('last_name' in userData)        fields.lastName = userData.last_name;
    if ('username' in userData)         fields.username = userData.username;
    usersCollection().updateOne(
        { userId: userData.id },
        { $set: fields },
        { upsert: true }
    );
}

async function updateGameStatus(ctx, action) {
    const [gameId, extraAction] = ctx.match[1].split('_');
    const userId = ctx.from.id;
    const username = extractUserTitle(ctx.from);
    const timestamp = new Date();//ctx.update.callback_query.date * 1000);

    const game = await gamesCollection().findOne({ _id: ObjectId.createFromHexString(gameId) });
    if (!game || !game.isActive) return;

    const newStatus = getStatusByAction(action);
    let playerInd = game.players.findIndex(p => p.id === userId && !p.extraPlayer);
    if (extraAction && (playerInd == -1 || game.players[playerInd].status !== 'joined')) {
        return ctx.reply('Перед тим як додавати/видаляти ігрока натисніть що Ви самі йдете на гру.');
    }
    let extraPlayer = game.players.length && Math.max(...game.players.map(p => p.id === userId && p.extraPlayer)) || 0;
    if (extraAction) {
        if (extraAction === 'minus') {
            if (extraPlayer <= 0) {
                return;
            }
            playerInd = game.players.findIndex(p => p.id === userId && p.extraPlayer === extraPlayer);
            game.players.splice(playerInd, 1);
        } else
            extraPlayer++;
    } else {
        if (playerInd >= 0) {
            if (game.players[playerInd].status === newStatus) {
                // status not changed
                return;
            }
            if (extraPlayer > 0) {
                return ctx.reply('Перед тим як змінювати свій статус видмініть похід на гру для додаткових ігроків, яких ви залучили.');
            }
            game.players.splice(playerInd, 1);
        }
    }

    if (extraAction !== 'minus')
        game.players.push({ id: userId, name: username, extraPlayer, status: newStatus, timestamp });
    game.players.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    await gamesCollection().updateOne({ _id: game._id }, { $set: { players: game.players } });

    updateGameMessage(game, gameId);
}

const  buildTextMessage = (game) => {
    const players = game.players || [];
    const m = (user) => (user.name[0] != '@' && user.name.indexOf(' ') == -1 ? '@' : '') + user.name +
        (user.extraPlayer ? '(+' + user.extraPlayer + ')': ''); // support values of usernames for older versions DB
    return textMarkdownNormalize(
        `📅 **${game.name} (${date2text(game.date)})**\n\n` +
        `👥 Кількість учасників ${players.filter(p => p.status === 'joined').length}/${game.maxPlayers}\n` +
        `✅ Йдуть: ${players.filter(p => p.status === 'joined').slice(0, game.maxPlayers).map(p => `${m(p)}`).join(', ') || '-'}\n` +
        `⏳ У черзі: ${players.filter(p => p.status === 'joined').slice(game.maxPlayers).map(p => `${m(p)}`).join(', ') || '-'}\n` +
        `❓ Думають: ${players.filter(p => p.status === 'pending').map(p => `${m(p)}`).join(', ') || '-'}\n` +
        `❌ Не йдуть: ${players.filter(p => p.status === 'declined').map(p => `${m(p)}`).join(', ') || '-'}\n\n` +
        `Опубліковано ${game.creatorName}`
    );
}

const buildMarkup = (gameId) => Markup.inlineKeyboard([
    Markup.button.callback('✅ Йду', `join_${gameId}`),
    Markup.button.callback('❓ Подумаю', `pending_${gameId}`),
    Markup.button.callback('❌ Не йду', `decline_${gameId}`),
    Markup.button.callback('✅ Йду +', `join_${gameId}_plus`),
    Markup.button.callback('❌ Не йду -', `decline_${gameId}_minus`)
], {columns: 3});

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

const sendNotification = async (dateStart, dateEnd, whenText, onlyIfDateWithTime) => {
    const games = await gamesCollection().find(
        {isActive: true, date: {$gte: dateStart, $lte: dateEnd}, ...(onlyIfDateWithTime && { isDateWithoutTime: false })}
    ).toArray();
    games.forEach(game =>
        bot.telegram.sendMessage(game.chatId, `🔔 Нагадування\n\n${whenText} відбудеться гра ${game.name}.`, { reply_to_message_id: game.messageId})
    );
}

cron.schedule('*/15 * * * *', () => {
    const date = new Date();
    const startOfDate = date.startOfDay();
    const filter = { $and: [{isActive: true}, {$or: [{date: {$lte: date}, isDateWithoutTime: false}, {date: {$lt: startOfDate}, isDateWithoutTime: {$ne: false}}]}] };
    gamesCollection().updateMany(
        filter,
        { $set: { isActive: false } }
    ).then(res => res.modifiedCount && console.log(`Deactivated ${res.modifiedCount} tasks`));
});

cron.schedule('0 16 * * *', async () => {
    sendNotification(new Date().addDays(1).startOfDay(), new Date().addDays(1).endOfDay(), 'Завтра');
});

cron.schedule('00 6 * * *', async () => {
    sendNotification(new Date().startOfDay(), new Date().endOfDay(), 'Сьогодні', true);
});

start();
