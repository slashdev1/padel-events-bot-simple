const cron = require('node-cron');

class Scheduler {
    constructor(database, bot) {
        this.database = database;
        this.bot = bot;
        this.jobs = [];
    }

    start() {
        this.scheduleGameDeactivation();
        this.scheduleDailyReminders();
        this.scheduleTodayReminders();
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

    scheduleDailyReminders() {
        const job = cron.schedule('0 16 * * *', async () => {
            await this.sendNotification(
                new Date().addDays(1).startOfDay(),
                new Date().addDays(1).endOfDay(),
                'Завтра'
            );
        });
        this.jobs.push(job);
    }

    scheduleTodayReminders() {
        const job = cron.schedule('00 6 * * *', async () => {
            await this.sendNotification(
                new Date().startOfDay(),
                new Date().endOfDay(),
                'Сьогодні',
                true
            );
        });
        this.jobs.push(job);
    }

    async sendNotification(dateStart, dateEnd, whenText, onlyIfDateWithTime = false) {
        const games = await this.database.getGamesForNotification(
            dateStart,
            dateEnd,
            onlyIfDateWithTime
        );

        games.forEach(async (game) => {
            let replyText = `🔔 Нагадування\n\n${whenText} відбудеться гра ${game.name}.`;
            try {
                await this.bot.sendMessage(game.chatId, replyText, { reply_to_message_id: game.messageId });
            } catch (error) {
                if (error?.code === 400) // 400: Bad Request: message to be replied not found
                    this.bot.sendMessage(game.chatId, replyText);
            }
        });
    }
}

module.exports = Scheduler;

