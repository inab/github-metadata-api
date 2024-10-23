const { Router, json } = require('express');
const router = Router();
var  { authApp, authUser }  = require('../shared/helpers/auth');
const { getInstallationID } = require('../shared/helpers/installation');
var info = require('debug')('node-api:info');
var error = require('debug')('node-api:error');
var debug = require('debug')('node-api:debug');
const MetadataUpdater = require('./updater.js');
const {
    getOctokit,
    getTargetBranch,
    getBranchesNames,
    generateBranchName,
    createBranch,
    createFile,
    createPullRequest,
} = require('./helpers/metadata');

/* ------------------------------------------------------------------ */


/**
 * @openapi
 * /metadata-updater-for-fairsoft/installation/id:
 *   get:
 *     summary: Get the installation ID for a repository.
 *     description: Retrieves the installation ID associated with a GitHub App for the specified repository.
 *     tags:
 *       - Metadata Updater for FAIRsoft
 *     parameters:
 *       - in: query
 *         name: owner
 *         schema:
 *           type: string
 *         required: true
 *         description: The GitHub username or organization that owns the repository.
 *       - in: query
 *         name: repo
 *         schema:
 *           type: string
 *         required: true
 *         description: The name of the GitHub repository.
 *     responses:
 *       200:
 *         description: Successfully retrieved the installation ID.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: integer
 *                   example: 12345678
 *                   description: The installation ID for the repository.
 *                 status:
 *                   type: integer
 *                   example: 200
 *       500:
 *         description: Failed to retrieve the installation ID due to an error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: null
 *                 status:
 *                   type: integer
 *                   example: 500
 *                 message:
 *                   type: string
 *                   example: An error occurred while retrieving the installation ID.
 */
router.get('/metadata-updater-for-fairsoft/installation/id', (req, res) => {
    // GET /metadata-updater-for-fairsoft/installation/id?owner=foo&repo=foo
    const { owner, repo } = req.query;
    
    console.debug(owner);
    console.debug(repo);

    authApp(MetadataUpdater.appID, MetadataUpdater.privateKeyPath).then((app) => {
        getInstallationID(app, owner, repo).then((data) => {
            res.json({
                data: data,
                status: 200,
            });
        }).catch((error) => {
            res.json({
                data: null,
                status: error.status,
                message: error.message,
            });
        });
    });
});



/**
 * @swagger
 * /metadata/pull:
 *   post:
 *     summary: Creates a pull request with a CodeMeta file.
 *     description: >
 *       This endpoint automates the process of creating a pull request in a GitHub repository.
 *       The pull request includes a CodeMeta file generated based on the provided metadata.
 *       The process includes:
 *       1. Retrieving the content to be added.
 *       2. Fetching the SHA of the master branch (either named 'master' or 'main').
 *       3. Creating a new branch from the master branch.
 *       4. Adding the file to the new branch and committing the changes.
 *       5. Creating a pull request from the new branch to the master branch.
 *     tags:
 *       - Metadata
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - owner
 *               - repo
 *               - filename
 *               - installationID
 *               - metadata
 *             properties:
 *               owner:
 *                 type: string
 *                 description: The owner of the repository.
 *               repo:
 *                 type: string
 *                 description: The name of the repository.
 *               filename:
 *                 type: string
 *                 description: The name of the file to be added.
 *               installationID:
 *                 type: integer
 *                 description: The installation ID for the GitHub App.
 *               metadata:
 *                 type: object
 *                 description: The metadata to be included in the CodeMeta file.
 *               title:
 *                 type: string
 *                 description: The title of the pull request. Defaults to "Metadata for this software" if not provided.
 *               message:
 *                 type: string
 *                 description: The commit message for the pull request. Defaults to a description message if not provided.
 *     responses:
 *       200:
 *         description: Successfully created the pull request.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: integer
 *                   description: HTTP status code.
 *                 code:
 *                   type: integer
 *                   description: Application status code.
 *                 message:
 *                   type: string
 *                   description: Success message.
 *                 new_branch_name:
 *                   type: string
 *                   description: The name of the newly created branch.
 *                 head_branch_name:
 *                   type: string
 *                   description: The name of the base branch (usually master or main).
 *                 url:
 *                   type: string
 *                   description: The URL of the created pull request.
 *                 pullrequest_message:
 *                   type: object
 *                   description: The full pull request response from GitHub.
 *       400:
 *         description: Bad Request. The input data is invalid.
 *       500:
 *         description: Internal Server Error. Something went wrong on the server side.
 */
router.post('/metadata/pull', async (req, res) => {
    /* 
    This endpoint creates a new pull request with the codemeta file. It does:
    1. Get content to add.
    2. Get SHA of master branch (name: master or main).
    3. Create a new branch from master.
    4. Add files to branch and commit:
    5. Create pull request
    */

    const { owner, repo, filename, branch, installationID, metadata, title, message } = req.body;

    // Set default values for title and message if not provided
    const defaultMessage = `Description of this software (\`${filename}\`) generated by [Metadata Updater for FAIRsoft](https://github.com/apps/metadata-updater-for-fairsoft) added.`;
    const defaultTitle = `Metadata/Citation for this software`;

    const finalTitle = title || defaultTitle;
    const finalMessage = message || defaultMessage;


    try{
        const content = btoa(metadata);  
        console.debug('content created')

        const octokit = await getOctokit(installationID);
        console.debug('octokit created')

        // Getting target branch information
        const targetBranch = await getTargetBranch(octokit, owner, repo, branch);
        const sha = targetBranch.mainSHA;
        const baseBranch = targetBranch.mainName;

        const branches = await getBranchesNames(octokit, owner, repo);
        const newBranchName = generateBranchName(branches)
    
        await createBranch(octokit, owner, repo, newBranchName, sha);

        console.debug(metadata)
        //octokit, owner, repo, branchName, path, content, message
        await createFile(octokit, owner, repo, newBranchName, filename, content, finalMessage);
        console.debug('file created')
        
        
        const pullrequest = await createPullRequest(octokit, 
            owner, 
            repo, 
            newBranchName, 
            baseBranch, 
            finalTitle,
            finalMessage
            );

        resp = {
            status: 200,
            code: 200,
            message: 'success',
            new_branch_name: newBranchName,
            head_branch_name: baseBranch,
            url: pullrequest.data.html_url,
            pullrequest_message: pullrequest
            }

    }catch(e){
        error(e);
        resp = {
            code: e.status,
            message: e.message
        }
        
    } finally {
        res.send(resp);
    }
    
})

module.exports = router;