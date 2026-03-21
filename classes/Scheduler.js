const cron = require('node-cron');

class Scheduler {
    constructor(database, bot, checkInterval = 5) {
        this.database = database;
        this.bot = bot;
        this.jobs = [];
        this.checkInterval = checkInterval;
    }

    start() {
        this.scheduleGameDeactivation();
        this.scheduleDynamicReminders();
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

    async processReminders() {
        //return;
        try {
            // Отримуємо ігри з налаштуваннями чатів через aggregation
            const now = new Date();
            const activeGames = await this.database.getActiveGamesWithSettings(now);

            for (const game of activeGames) {
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
                        const reminderTime = new Date(game.date.getTime() + minutesBefore * 60000);
                        const timeWindowEnd = new Date(reminderTime.getTime() + this.checkInterval * 60000);

                        // Якщо поточний час більший або рівний часу нагадування
                        if (now >= reminderTime && now < timeWindowEnd) {
                            await this.sendDynamicNotification(game, minutesBefore);
                        }
                    }
                }

                // 2. Нотифікації для ігроків
                const userIds = [...new Set(game.players.filter(p => p.status === 'joined').map(p => p.id))];
                for (const userId of userIds) {
                    let user = await this.database.getUser(userId);
                    if (!user || !user.started) continue;

                    termsString = user.settings && user.settings.notificationTerms;
                    if (termsString === '') continue;

                    termsString = termsString || "-1440,-60";
                    const terms = termsString.split(',').map(Number);

                    for (const minutesBefore of terms) {
                        const reminderTime = new Date(game.date.getTime() + minutesBefore * 60000);
                        const timeWindowEnd = new Date(reminderTime.getTime() + this.checkInterval * 60000);

                        // Якщо поточний час більший або рівний часу нагадування
                        if (now >= reminderTime && now < timeWindowEnd) {
                            await this.sendDynamicNotificationToUser(game, user, minutesBefore);
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
        const replyText = `🔔 Нагадування\n\nГра "${game.name}" відбудеться ${timeText}!`;

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
        const replyText = `🔔 Нагадування\n\nГра "${game.name}" відбудеться ${timeText}!`;
        console.log(`Відправка користувачу ${user.userId} повідомлення ${replyText}`);

        try {
            await this.bot.sendMessage(user.userId, replyText);
        } catch (error) {
            if (error?.code === 403) {
                await this.database.updateUser({id: user.userId, started: false, startedTimestamp: new Date()});
                return;
            }
            console.error(`[Telegram Error] Chat ${user.userId}:`, error.message);
        }
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


