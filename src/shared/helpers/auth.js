const { Octokit, App } = require('octokit');


/**
 * Authenticate as an installation of an app.
 * Returns an authenticated instance of octokit.
 *
 * @param {number} appID - The ID of the app.
 * @param {string} privateKeyPath - The path to the app's private key file.
 * @returns {Promise<App>} - A promise that resolves to an authenticated instance of octokit.
 */
async function authApp(appID, privateKeyPath) {
    const fs = require("fs");

    try {
        // Reading the app private key from the appropriate file
        var myKey = fs.readFileSync(privateKeyPath, "utf8");

        console.debug(`appID: ${appID}`);
        console.debug(`myKey: ${myKey}`);

        // Creating the app instance
        const app = await new App({
            appId: appID,
            privateKey: myKey,
        });

        return app;
    } catch (error) {
        // Log the error and return null or an appropriate value
        console.error("Error in authApp:", error);
        return null; // or throw new Error('Failed to authenticate app') if you want to propagate the error
    }
}

/**
 * Authenticates the user using a personal access token.
 * 
 * @param {string} token - The personal access token for authentication.
 * @returns {Octokit} - An instance of the Octokit client authenticated with the provided token.
 */
async function authUser(token) {
    const octokit = new Octokit({
        auth: token,
    });

    return octokit;
}


module.exports = {
    authApp,
    authUser
}