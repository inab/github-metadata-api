/**
 * Retrieves the installation ID for a given repository.
 *
 * Errors are not caught here: a 404 means the app is not installed on the repository,
 * and the routes need that status to report it instead of a successful null.
 *
 * @param {Object} app - The GitHub app object.
 * @param {string} owner - The owner of the repository.
 * @param {string} repo - The name of the repository.
 * @returns {Promise<Object>} - A promise that resolves to the installation object.
 * @throws {Error} If GitHub rejects the request, with the HTTP status in `status`.
 */
async function getInstallationID(app, owner, repo) {
    return app.octokit.request(`/repos/${owner}/${repo}/installation`);
}

module.exports = {
    getInstallationID
}
