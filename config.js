const dotenv = require('dotenv');

const loadEnvConfig = () => {
    const env = process.env.NODE_ENV || 'development';
    const envFile = `.env.${env}`;
    dotenv.config({ path: envFile });
};

module.exports = loadEnvConfig;