var  { authApp, authUser }  = require('../../shared/helpers/auth');
const MetadataUpdater = require('../updater.js');
var info = require('debug')('node-api:info');
var error = require('debug')('node-api:error');

/**
 * Asynchronously retrieves an Octokit instance authenticated for a specific GitHub App installation.
 * 
 * This function uses app-level authentication to obtain an Octokit instance that can interact with the GitHub API
 * on behalf of the specified installation ID.
 * 
 * @param {number} installationID - The GitHub App installation ID for which the Octokit instance should be created.
 * 
 * @returns {object} octokit - An authenticated Octokit instance for the specified installation.
 * 
 * @example
 * // Usage example:
 * const octokit = await getOctokit(123456);
 * 
 * @throws {Error} If there is an issue with authentication or obtaining the Octokit instance.
 */
async function getOctokit(installationID) {
    
    // try to get installation octokit
    try {
        console.debug('getting installation')
        const app = await authApp(MetadataUpdater.appID, MetadataUpdater.privateKeyPath);
        const octokit = await app.getInstallationOctokit(installationID);
        console.debug('got octokit')
        return octokit;
    } catch (error) {
        console.error('Error getting installation:', error);
        throw new Error('Failed to get Octokit instance for installation');
    }

} 


/**
 * Converts a JSON object into a Base64-encoded string.
 * 
 * This function takes a JavaScript object, serializes it to a JSON string, 
 * and then encodes that string into Base64 format.
 * 
 * @param {object} object - The JSON object to be converted into a Base64 string.
 * 
 * @returns {string} - The Base64-encoded string representation of the JSON object.
 * 
 * @example
 * // Example usage:
 * const myObject = { key: "value" };
 * const base64String = jsonToBase64(myObject);
 * console.log(base64String); // Outputs the Base64 string
 */
function jsonToBase64(object) {
    const json = JSON.stringify(object);
    return Buffer.from(json).toString("base64");
}


async function getTargetBranch(octokit, owner, repo, branchName) {
    console.log('Fetching details of branch', branchName);
    const resp = await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
        owner: owner,
        repo: repo,
        branch: branchName,
    })

    const branch = resp.data;
    
    return {
        mainSHA: branch.commit.sha,
        mainName: branch.name,
    }
    
}


async function getBranchesNames(octokit, owner, repo) {
    const resp = await octokit.request('GET /repos/{owner}/{repo}/branches', {
        owner: owner,
        repo: repo,
    })
    const branches = resp.data;
    const allBranchesNames = branches.map((branch) => branch.name);

    console.log('All branches names: ', allBranchesNames)

    return allBranchesNames

}



/**
 * Generates a new branch name based on existing "evaluator" branches in a repository.
 * 
 * This function searches through the list of branch names for branches that match the pattern "evaluator" or "evaluator-n"
 * where "n" is a number. It then generates a new branch name by incrementing the highest number found. 
 * If no "evaluator" branches exist, it returns "evaluator-1".
 * 
 * @param {object} branches - An object containing all branch names in the repository.
 * @param {string[]} branches.allBranchNames - An array of all branch names in the repository.
 * 
 * @returns {string} - The newly generated branch name, e.g., "evaluator-2" if "evaluator-1" already exists.
 * 
 * @example
 * // Example usage:
 * const newBranchName = generateBranchName({ allBranchNames: ['master', 'evaluator', 'evaluator-1'] });
 * console.log(newBranchName); // Outputs: "evaluator-2"
 * 
 * @throws {Error} If the input branches object does not contain a valid array of branch names.
 */
function generateBranchName(branches) {
    if (!branches || !Array.isArray(branches)) {
        throw new Error('Invalid input: allBranchNames must be an array.');
    }

    // Regex to match 'evaluator' or 'evaluator-n' and capture the number
    const re = /^evaluator(?:-(\d+))?$/;
    const evaluator_branches = branches.map(branch => {
        const match = re.exec(branch);
        return match ? parseInt(match[1], 10) || 0 : null;
    }).filter(number => number !== null);

    // Determine the next branch name
    const nextNumber = evaluator_branches.length > 0 ? Math.max(...evaluator_branches) + 1 : 1;
    return `evaluator-${nextNumber}`;
}


/**
 * Asynchronously creates a new branch in a GitHub repository from a specified commit SHA.
 * 
 * This function creates a new branch in the given repository using the provided branch name and the SHA of the commit
 * from which the branch should be created (typically from the master or main branch).
 * 
 * @param {object} octokit - An authenticated Octokit instance used to interact with the GitHub API.
 * @param {string} owner - The GitHub username or organization that owns the repository.
 * @param {string} repo - The name of the GitHub repository.
 * @param {string} branchName - The name of the new branch to be created.
 * @param {string} sha - The SHA of the commit from which the new branch should be created.
 * 
 * @returns {object} resp - The response from the GitHub API, containing details about the created branch.
 * 
 * @example
 * // Example usage:
 * const response = await createBranch(octokit, 'exampleUser', 'exampleRepo', 'new-branch', 'abc123def456');
 * console.log(response.data); // Outputs the details of the created branch
 * 
 * @throws {Error} If the GitHub API request fails, an error is thrown with the relevant information.
 */
async function createBranch(octokit, owner, repo, branchName, sha) {
    console.log('Creating new branch:', branchName);

    try {
        const resp = await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
            owner: owner,
            repo: repo,
            ref: `refs/heads/${branchName}`,
            sha: sha,
        });
        
        console.log('Branch created successfully:', branchName);
        return resp;
    } catch (error) {
        console.error('Error creating branch:', error.message);
        throw new Error(`Failed to create branch '${branchName}' in repository '${owner}/${repo}': ${error.message}`);
    }
}


/**
 * Asynchronously creates or updates a file in a specified branch of a GitHub repository.
 * 
 * This function first checks if a file already exists at the specified path in the given branch.
 * If the file exists, it updates the file with the new content. If the file does not exist, it creates a new file.
 * The content is provided in Base64 encoding, and a commit message is included with the change.
 * 
 * @param {object} octokit - An authenticated Octokit instance used to interact with the GitHub API.
 * @param {string} owner - The GitHub username or organization that owns the repository.
 * @param {string} repo - The name of the GitHub repository.
 * @param {string} branchName - The name of the branch where the file should be created or updated.
 * @param {string} path - The file path where the file should be created or updated.
 * @param {string} content - The Base64-encoded content of the file.
 * @param {string} message - The commit message associated with creating or updating the file.
 * 
 * @returns {object} resp - The response from the GitHub API, containing details about the created or updated file.
 * 
 * @example
 * // Example usage:
 * const response = await createFile(octokit, 'exampleUser', 'exampleRepo', 'new-branch', 'path/to/file.txt', 'SGVsbG8gd29ybGQ=', 'Add hello world file');
 * console.log(response.data); // Outputs the details of the created or updated file
 * 
 * @throws {Error} If an error occurs during the process, an error is thrown with the relevant information.
 */
async function createFile(octokit, owner, repo, branchName, path, content, message) {
    console.log('Creating or updating file:', path);
    console.log('Repository:', owner, repo);

    94727
    let contents;

    // Log the content and its type
    console.log('Content:', content);
    console.log('Type of content:', typeof content);



    // Optionally, you can check if the content is a valid base64 string
    const isBase64 = Buffer.from(content, 'base64').toString('base64') === content;
    console.log('Is content a valid base64 string?', isBase64);

    try {
        // Check if the file already exists
        contents = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            owner: owner,
            repo: repo,
            path: path,
        });
    } catch (error) {
        if (error.status === 404) {
            // File does not exist, so proceed to create it
            contents = null;
        } else {
            // Some other error occurred
            console.error('Error fetching file contents:', error.message);
            throw new Error(`Failed to retrieve file at path '${path}' in repository '${owner}/${repo}': ${error.message}`);
        }
    }

    try {
        const requestConfig = {
            owner: owner,
            repo: repo,
            path: path,
            branch: branchName,
            message: message,
            committer: {
                name: 'Metadata Updater for FAIRsoft',
                email: 'openebench@bsc.es'
            },
            content: content // The new file content, using Base64 encoding.
        };

        if (contents && contents.status === 200) {
            // File already exists, update the file
            requestConfig.sha = contents.data.sha;
            console.log('File exists, updating:', path);
        } else {
            // File does not exist, create it
            console.log('File does not exist, creating:', path);
        }

        const resp = await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', requestConfig);
        console.log('File created/updated successfully:', path);
        return resp;
    } catch (error) {
        console.error('Error creating or updating file:', error.message);
        throw new Error(`Failed to create or update file at path '${path}' in repository '${owner}/${repo}': ${error.message}`);
    }
}


/**
 * Asynchronously creates a new pull request in a specified GitHub repository.
 * 
 * This function creates a pull request from a specified head branch to a base branch in the given repository.
 * The pull request includes a title and an optional body describing the changes.
 * 
 * @param {object} octokit - An authenticated Octokit instance used to interact with the GitHub API.
 * @param {string} owner - The GitHub username or organization that owns the repository.
 * @param {string} repo - The name of the GitHub repository.
 * @param {string} head - The name of the branch where the changes are implemented (source branch).
 * @param {string} base - The name of the branch into which the changes should be merged (target branch).
 * @param {string} title - The title of the pull request.
 * @param {string} [body] - The body or description of the pull request (optional).
 * 
 * @returns {object} resp - The response from the GitHub API, containing details about the created pull request.
 * 
 * @example
 * // Example usage:
 * const response = await createPullRequest(octokit, 'exampleUser', 'exampleRepo', 'feature-branch', 'main', 'Add new feature', 'This pull request adds a new feature...');
 * console.log(response.data); // Outputs the details of the created pull request
 * 
 * @throws {Error} If an error occurs during the pull request creation, an error is thrown with the relevant information.
 */
async function createPullRequest(octokit, owner, repo, head, base, title, body) {
    console.log('Creating pull request from branch:', head, 'to branch:', base);

    try {
        const resp = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
            owner: owner,
            repo: repo,
            title: title,
            head: head,
            base: base,
            body: body,
            accept: 'application/vnd.github+json'
        });

        console.log('Pull request created successfully:', resp.data.html_url);
        return resp;
    } catch (error) {
        console.error('Error creating pull request:', error.message);
        throw new Error(`Failed to create pull request from branch '${head}' to branch '${base}' in repository '${owner}/${repo}': ${error.message}`);
    }
}



module.exports = {
    getOctokit,
    jsonToBase64,
    getBranchesNames,
    getTargetBranch,
    generateBranchName,
    createBranch,
    createFile,
    createPullRequest
};