/*
Important parameters for the metadata updater
To use them in the routes, you can import them like this:

const MetadataUpdater =  require('./updater.js');
console.log(MetadataUpdater.APP_ID); // Outputs 'updater_app_id'
*/

require('dotenv').config();
require('dotenv').config({
    path: process.env.NODE_ENV === 'production' ? '/app/variables/.env' : './variables/.env'
});


module.exports = {
    appID: process.env.UPDATER_APP_ID,
    privateKeyPath: process.env.UPDATER_PRIVATE_KEY_PATH,
    githubClientID: process.env.UPDATER_GITHUB_CLIENT_ID,
    githubClientSecret: process.env.UPDATER_GITHUB_CLIENT_SECRET,
    githubCallbackUrl: process.env.UPDATER_GITHUB_CALLBACK_URL
};
