let extraData;

const updateExtra = (extra) => extraData = extra;

module.exports = {
    express: (port, extra) => {
        updateExtra(extra);
        const express = require('express');

        const app = express();

        app.get('/', (req, res) => {
            res.send(`Bot is running! Follow to <a href="${extraData?.botUrl}">${extraData?.botUrl}</a>`);
        })

        app.listen(port, () => {
            console.log(`Express app listening on port ${port}`);
        })
    },
    updateExtra
};