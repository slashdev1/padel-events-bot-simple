let extraData;

const updateExtra = (extra) => extraData = extra;

module.exports = {
    express: (port, extra) => {
        updateExtra(extra);
        const express = require('express');

        const app = express();

        app.get('/', (req, res) => {
            res.send(`Bot is running! Follow to ${extraData?.botUrl}`);
        })

        app.listen(port, () => {
            console.log(`Express app listening on port ${port}`);
        })
    },
    updateExtra
};