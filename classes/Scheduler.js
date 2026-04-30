const cron = require('node-cron');
const { isDate, sleep } = require('../helpers/utils');

class Scheduler {
    constructor(database, bot, checkInterval = 5) {
        this.database = database;
        this.bot = bot;
        this.jobs = [];
        this.checkInterval = checkInterval;
        this.emoji = require('../config/emoji.json');
    }

    start() {
        this.scheduleGameDeactivation();
        this.scheduleDynamicReminders();
        this.scheduleVotesNotifications();
    }

    stop() {
        this.jobs.forEach(job => job.destroy && job.destroy());
        this.jobs = [];
    }

    scheduleGameDeactivation() {
        const job = cron.schedule('*/15 * * * *', () => {
            this.database.deactivateExpiredGames();
        });
        this.jobs.push(job);
    }

    scheduleDynamicReminders() {
        const job = cron.schedule(`*/${this.checkInterval} * * * *`, async () => {
            await this.processReminders();
        });
        this.jobs.push(job);
    }

    scheduleVotesNotifications() {
        const job = cron.schedule(`*/${this.checkInterval} * * * *`, async () => {
            await this.processVotesNotifications();
        });
        this.jobs.push(job);
    }

    async processReminders() {
        //return;
        try {
            // Отримуємо ігри з налаштуваннями чатів через aggregation
            const now = new Date();
            const activeGames = await this.database.getActiveGamesWithChatSettings();

            for (const game of activeGames) {
                let gameDate = game.date;
                let isDateWithoutTime = game.isDateWithoutTime;
                // TODO: для кожної сабгри з майбутньою датою треба нотифікації!!!
                let subgame = game.subgames.find(item => isDate(item.date) && item.date > now);
                if (subgame) {
                    gameDate = subgame.date;
                    isDateWithoutTime = subgame.isDateWithoutTime;
                }
                if (isDateWithoutTime || !gameDate || gameDate < now) {
                    // Нагадування мають сенс:
                    // 1. коли вказана дата
                    // 2. тільки коли вказаний час проведення
                    // 3. коли дата у майбутньому
                    continue;
                }

                // 1. Нотифікації для груп
                let termsString = game.notificationTerms;
                if (termsString === '') {
                    // Якщо поле notificationTerms присутнє і воно пусте, це означає що не треба нагадувань
                } else {
                    // Якщо налаштування не задані, використовуємо дефолт (наприклад, за добу та за годину)
                    termsString = termsString || "-1440,-60";
                    const terms = termsString.split(',').map(Number);

                    for (const minutesBefore of terms) {
                        // // Перевіряємо, чи ми вже не надсилали САМЕ ЦЕ нагадування
                        // if (game.sentReminders && game.sentReminders.includes(minutesBefore)) {
                        //     continue;
                        // }

                        // Рахуємо час, коли має спрацювати нагадування
                        // Оскільки minutesBefore від'ємні (наприклад, -60), додаємо їх
                        const reminderTime = new Date(gameDate.getTime() + minutesBefore * 60000);
                        const timeWindowEnd = new Date(reminderTime.getTime() + this.checkInterval * 60000);

                        // Якщо поточний час більший або рівний часу нагадування
                        if (now >= reminderTime && now < timeWindowEnd) {
                            await this.sendDynamicNotification(game, minutesBefore);
                            await sleep(200);
                        }
                    }
                }

                // 2. Нотифікації для ігроків
                const userIds = [...new Set(game.players.filter(p => p.status === 'joined').map(p => p.id))];
                // Ігроки що підписались на нагадування за 1 годину (-60)
                const userIdsSubscribed = game.notifications.filter(v => userIds.includes(v.userId)).map(v => v.userId);
                for (const userId of userIds) {
                    // TODO: отримувати 1 раз усіх юзерів
                    let user = await this.database.getUser(userId);
                    if (!user || !user.started) continue;

                    termsString = user.settings && user.settings.notificationTerms;
                    const isSubscribed = userIdsSubscribed.includes(userId);
                    if (isSubscribed) {
                        // Якщо ігрок натиснув, то треба нагадування у будь якому випадку
                    } else {
                        // Якщо поле notificationTerms присутнє і воно пусте, це означає що не треба нагадувань
                        if (termsString === '') continue;
                    }
                    termsString = termsString || "-1440,-60";
                    const terms = termsString.split(',').map(Number);
                    if (isSubscribed && !terms.includes(-60)) terms.push(-60); // Дефолтний термін нагадування за 1 годину, якщо ігрок натиснув відповідну кнопку у грі

                    for (const minutesBefore of terms) {
                        const reminderTime = new Date(gameDate.getTime() + minutesBefore * 60000);
                        const timeWindowEnd = new Date(reminderTime.getTime() + this.checkInterval * 60000);

                        // Якщо поточний час більший або рівний часу нагадування
                        if (now >= reminderTime && now < timeWindowEnd) {
                            await this.sendDynamicNotificationToUser(game, user, minutesBefore);
                            await sleep(200);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Помилка планувальника:', error);
        }
    }

    async sendDynamicNotification(game, minutesBefore) {
        const timeText = this.formatMinutesText(minutesBefore);
        const replyText = `${this.emoji.notif} Нагадування\n\nГра "${game.name}" відбудеться ${timeText}!`;

        try {
            await this.bot.sendMessage(game.chatId, replyText, {
                reply_to_message_id: game.messageId
            });

            // Позначаємо в БД, що це нагадування відправлено
            //await this.database.markReminderAsSent(game._id, minutesBefore);
        } catch (error) {
            // Якщо повідомлення, на яке треба відповісти, видалене
            if (error.response?.body?.description?.includes('message to be replied not found')) {
                await this.bot.sendMessage(game.chatId, replyText);
                //await this.database.markReminderAsSent(game._id, minutesBefore);
            } else {
                console.error(`[Telegram Error] Chat ${game.chatId}:`, error.message);
            }
        }
    }

    async sendDynamicNotificationToUser(game, user, minutesBefore) {
        if (!user.started) return;

        const timeText = this.formatMinutesText(minutesBefore);
        const replyText = `${this.emoji.notif} Нагадування\n\nГра "${game.name}" відбудеться ${timeText}!`;
        console.log(`Відправка користувачу ${user.userId} повідомлення ${replyText}`);

        // try {
        //     await this.bot.sendMessage(user.userId, replyText);
        // } catch (error) {
        //     //!!!
        //     if (error?.code === 403) {
        //         await this.database.updateUser({ id: user.userId, started: false });
        //         return;
        //     }
        //     console.error(`[Telegram Error] Chat ${user.userId}:`, error.message);
        // }
        await this.bot.sendMessageEx(user.userId, replyText);
    }

    async processVotesNotifications() {
        await sleep(5000);
        // console.log(`🔔 processVotesNotifications: start`);
        try {
            const now = new Date();
            const chats = await this.database.getChatsWithVotesNotificationSettings();
            // console.log(`🔔 processVotesNotifications: ${chats.length} chats`);
            const dueChats = [];
            let minFromDate = null;
            const nowMinute = now.getUTCMinutes();

            for (const chatSettings of chats) {
                const settings = chatSettings.settings || {};
                const termsRaw = (settings.votesNotificationTerms || '').trim();
                const intervalMinutes = Number(termsRaw);
                if (!Number.isInteger(intervalMinutes) || intervalMinutes <= 0) continue;
                // Без збереження last-check у БД: шлемо лише на "слотах" інтервалу.
                // При кроні кожні 5 хв це прибирає дублювання.
                if (nowMinute % intervalMinutes !== 0) continue;
                const fromDate = new Date(now.getTime() - intervalMinutes * 60000);
                if (!minFromDate || fromDate < minFromDate) minFromDate = fromDate;
                dueChats.push({ chatSettings, intervalMinutes, fromDate });
            }

            if (!dueChats.length || !minFromDate) return;
            // console.log(`🔔 processVotesNotifications: ${dueChats.length} due chats`);

            const chatIds = dueChats.map((item) => item.chatSettings.chatId);
            const allRows = await this.database.getVoteHistoryChangesByChats(chatIds, minFromDate, now);
            console.log(`🔔 processVotesNotifications: ${allRows.length} allRows`);
            const allGameIds = [...new Set(allRows.map((row) => /*String(row.gameId)*/row.gameId))];
            const allHistoryRows = await this.database.getVoteHistoryByGameIds(allGameIds);
            // console.log(`🔔 processVotesNotifications: ${allHistoryRows.length} allHistoryRows`);
            const historyByGameId = new Map();
            for (const row of allHistoryRows) {
                const gid = String(row.gameId);
                if (!historyByGameId.has(gid)) historyByGameId.set(gid, []);
                historyByGameId.get(gid).push(row);
            }

            for (const item of dueChats) {
                const { chatSettings, intervalMinutes, fromDate } = item;
                const rows = allRows.filter((row) =>
                    row.chatId === chatSettings.chatId &&
                    row.timestamp > fromDate &&
                    row.timestamp <= now
                );
                // console.log(`🔔 processVotesNotifications: ${rows.length} rows`);
                if (rows.length) {
                    const rowsByGame = new Map();
                    for (const row of rows) {
                        const gid = String(row.gameId);
                        if (!rowsByGame.has(gid)) rowsByGame.set(gid, []);
                        rowsByGame.get(gid).push(row);
                    }

                    for (const [gid, newRowsByGame] of rowsByGame.entries()) {
                        const allRowsByGame = historyByGameId.get(gid) || [];
                        const getRowKey = (row) => String(row?._id || `${row?.timestamp?.getTime?.() || row?.timestamp}|${row?.userId}|${row?.action}|${row?.prevStatus}|${row?.newStatus}`);
                        const newRowsKeys = new Set(newRowsByGame.map((row) => getRowKey(row)));
                        const allRowsByGameWithFlags = allRowsByGame.map((row) => ({
                            ...row,
                            _doNotShow: !newRowsKeys.has(getRowKey(row))
                        }));
                        const msg = this.buildVotesNotificationMessage(newRowsByGame, allRowsByGameWithFlags, intervalMinutes, chatSettings.chatId);
                        if (!msg) continue;

                        const replyToMessageId = newRowsByGame[0]?.gameMessageId;
                        try {
                            await this.bot.sendMessageEx(chatSettings.chatId, msg, replyToMessageId ? { reply_to_message_id: replyToMessageId } : {});
                        } catch (error) {
                            if (error.response?.body?.description?.includes('message to be replied not found')) {
                                await this.bot.sendMessageEx(chatSettings.chatId, msg);
                            } else {
                                console.error(error);
                            }
                        } finally {
                            await sleep(200);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Помилка при відправці зведення по голосуваннях:', error);
        }
    }

    buildVotesNotificationMessage(newRows, allRows, intervalMinutes, chatId) {
        if (!newRows.length) return '';

        const firstLine = `🗳️ Зміни голосів за останні ${intervalMinutes} хв:`;
        //_doNotShow
        return this.bot._buildVotesNotificationMessage(firstLine, allRows, newRows[0]?.timezone, newRows[0]?.gameMaxPlayers);
        /*
        const status2emoji = (status) => {
            if (status === 'joined') return '✅';
            if (status === 'declined') return '❌';
            if (status === 'pending') return '❓';
            if (status === 'kicked') return this.emoji.kick;
            return '⚪';
        };

        const action2text = (row) => {
            if (row.action === 'extra_plus') return '➕ +1';
            if (row.action === 'extra_minus') return '➖ -1';
            if (row.prevStatus) return `${status2emoji(row.prevStatus)}→${status2emoji(row.newStatus)}`;
            return `${status2emoji(row.newStatus)}`;
        };

        let directJoined = 0;
        let extraJoined = 0;
        for (const item of allRows) {
            if (item.action === 'extra_minus') {
                extraJoined--;
            } else if (item.action === 'extra_plus') {
                extraJoined++;
            } else {
                if (item.newStatus === 'joined') directJoined++;
                if (item.prevStatus === 'joined') directJoined--;
            }
        }
        if (directJoined < 0) directJoined = 0;
        if (extraJoined < 0) extraJoined = 0;
        const joinedTotal = directJoined + extraJoined;

        const gameName = newRows[0]?.gameName || '(гра видалена)';
        const gameMaxPlayers = newRows[0]?.gameMaxPlayers;
        const lines = newRows.map((row) => {
            const timeText = row.timestamp instanceof Date
                ? row.timestamp.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
                : '--:--';
            const playerName = row.fullName || row.username || `id=${row.userId}`;
            return `${timeText}, ${playerName} ${action2text(row)}`;
        });

        return `🗳️ Зміни голосів за останні ${intervalMinutes} хв:\n\n` +
            //`🏟 ${gameName}\n` +
            lines.join('\n') +
            '\n' + '—'.repeat(18) +
            `\nКількість учасників ${joinedTotal}${gameMaxPlayers ? '/' + gameMaxPlayers : ''}, з них\n  ✅ ${directJoined}\n  ➕ ${extraJoined}`;*/
    }

    /**
     * Форматує текст нагадування у формат "X днів Y годин Z хвилин"
     * Прибирає блоки, якщо значення дорівнює 0
     */
    formatMinutesText(minutes) {
        const totalMinutes = Math.abs(minutes);

        if (totalMinutes === 0) return "зараз";
        // Спеціальний випадок для доби (традиційно для ботів)
        if (totalMinutes === 1440) return "завтра";

        const days = Math.floor(totalMinutes / 1440);
        const hours = Math.floor((totalMinutes % 1440) / 60);
        const mins = totalMinutes % 60;

        const parts = [];

        if (days > 0) {
            parts.push(`${days} ${this.getPlural(days, 'день', 'дні', 'днів')}`);
        }

        if (hours > 0) {
            parts.push(`${hours} ${this.getPlural(hours, 'годину', 'години', 'годин')}`);
        }

        if (mins > 0) {
            parts.push(`${mins} ${this.getPlural(mins, 'хвилину', 'хвилини', 'хвилин')}`);
        }

        // З'єднуємо частини (наприклад: "1 день 2 години 5 хвилин")
        return `через ${parts.join(' ')}`;
    }

    /**
     * Повертає правильну форму іменника залежно від числа
     */
    getPlural(number, one, few, many) {
        const n = Math.abs(number) % 100;
        const n1 = n % 10;

        // Для чисел 11-19 завжди "днів/годин/хвилин"
        if (n > 10 && n < 20) return many;

        // Для чисел, що закінчуються на 2, 3, 4 (крім 12, 13, 14)
        if (n1 > 1 && n1 < 5) return few;

        // Для чисел, що закінчуються на 1 (крім 11)
        if (n1 === 1) return one;

        // Для всіх інших (0, 5-9)
        return many;
    }
}

module.exports = Scheduler;