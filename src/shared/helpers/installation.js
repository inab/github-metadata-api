
/**
 * Retrieves the installation ID for a given repository.
 *
 * @param {Object} app - The GitHub app object.
 * @param {string} owner - The owner of the repository.
 * @param {string} repo - The name of the repository.
 * @returns {Promise<Object>} - A promise that resolves to the installation object.
 */
async function getInstallationID(app, owner, repo) {
    try {
        // Attempt to fetch the installation ID
        const installation = await app.octokit.request(`/repos/${owner}/${repo}/installation`);
        
        return installation;
    } catch (error) {
        // Log the error and return null or an appropriate value
        console.error("Error in getInstallationID:", error);
        return null; // or you could return a custom error object or throw an error if needed
    }
}

module.exports = {
    getInstallationID
}
