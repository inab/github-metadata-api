/*
Important parameters for the metadata extractor
To use them in the routes, you can import them like this:

const MetadataExtractor = require('./extractor.js');
console.log(MetadataExtractor.APP_ID); // Outputs 'extractor_app_id'
*/

require('dotenv').config();
require('dotenv').config({
    path: process.env.NODE_ENV === 'production' ? '/app/variables/.env' : './variables/.env'
});

module.exports = {
    appID: process.env.EXTRACTOR_APP_ID,
    privateKeyPath: process.env.EXTRACTOR_PRIVATE_KEY_PATH,
    githubClientID: process.env.EXTRACTOR_GITHUB_CLIENT_ID,
    githubClientSecret: process.env.EXTRACTOR_GITHUB_CLIENT_SECRET,
    githubCallbackUrl: process.env.EXTRACTOR_GITHUB_CALLBACK_URL
};
