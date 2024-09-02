
/**
 * Retrieves the installation ID for a given repository.
 *
 * @param {Object} app - The GitHub app object.
 * @param {string} owner - The owner of the repository.
 * @param {string} repo - The name of the repository.
 * @returns {Promise<Object>} - A promise that resolves to the installation object.
 */
async function getInstallationID(app, owner, repo){
    const installation = await app.octokit.request(`/repos/${owner}/${repo}/installation`);
    
    return installation;

}

module.exports = {
    getInstallationID
}
