const { Router, json } = require('express');
const router = Router();
const {
    PrepareListsIds,
    getRepositoryMetadata,
    fetchDocumentationFiles,
    getReadmeContent,
    getCitationContent,
    parseCitationCFF,
    removeDuplicatePublications,
    extractJournalPublication
} = require('./helpers/metadata');
var  { authApp, authUser }  = require('../shared/helpers/auth');
const { getInstallationID } = require('../shared/helpers/installation');
var info = require('debug')('node-api:info');
var error = require('debug')('node-api:error');
const MetadataExtractor = require('./extractor.js');


/* ------------------------------------------------------------------ */

/**
 * @openapi
 * /metadata-extractor-for-fairsoft/installation/id:
 *   get:
 *     summary: Get the installation ID for a repository.
 *     description: Retrieves the installation ID associated with a GitHub App for the specified repository.
 *     tags:
 *       - Metadata Extractor for FAIRsoft
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
router.get('/metadata-extractor-for-fairsoft/installation/id', (req, res) => {
    // GET /installation/id?owner=foo&repo=foo
    const { owner, repo } = req.query;
    
    console.log(owner);
    console.log(repo);

    authApp(MetadataExtractor.appID, MetadataExtractor.privateKeyPath).then((app) => {
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
 * @openapi
 * /metadata:
 *   post:
 *     summary: Fetch metadata from a GitHub repository using the app's access token.
 *     description: >
 *       This endpoint fetches metadata from a GitHub repository using the app's access token.
 *       It performs the following steps:
 *       1. Authenticates the app.
 *       2. Retrieves the installation's Octokit instance.
 *       3. Fetches repository metadata.
 *       4. Optionally fetches documentation files and README content.
 *       5. Extracts and processes citation information.
 *       6. Optionally prepares the metadata before sending the response.
 *     tags:
 *       - Metadata Extractor for FAIRsoft
 *     requestBody:
 *       description: Required parameters to fetch the metadata.
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               owner:
 *                 type: string
 *                 description: The owner of the GitHub repository.
 *               repo:
 *                 type: string
 *                 description: The name of the GitHub repository.
 *               installationID:
 *                 type: string
 *                 description: The installation ID of the GitHub App.
 *               prepare:
 *                 type: boolean
 *                 description: Whether to prepare the repository before extracting metadata.
 *                 default: true
 *               readme_extract:
 *                 type: boolean
 *                 description: Whether to extract metadata from the repository's README file.
 *                 default: false
 *     responses:
 *       200:
 *         description: Successfully fetched the repository metadata.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   description: The repository metadata, including documentation, citation, and publication details.
 *                 status:
 *                   type: integer
 *                   example: 200
 *       500:
 *         description: Failed to fetch the repository metadata due to an error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: null
 *                 message:
 *                   type: string
 *                   example: An error occurred
 */
router.post('/metadata', async (req, res) => {
    const { owner, repo, installationID, prepare = true, readme_extract = false } = req.body;

    try {
        info('Authenticating app');
        const app = await authApp(MetadataExtractor.appID, MetadataExtractor.privateKeyPath);
        
        info('App authenticated. Getting installation octokit');
        const octokit = await app.getInstallationOctokit(installationID);
        
        info('Installation octokit retrieved. Getting repository metadata');
        let metadata = await getRepositoryMetadata(octokit, owner, repo);

        info('Fetching documentation files');
        const documentation = await fetchDocumentationFiles(octokit, owner, repo);
        metadata.documentation = documentation;

        if (readme_extract) {
            info('Fetching README content');
            const readmeContent = await getReadmeContent(octokit, owner, repo);
            metadata.publication = extractJournalPublication(readmeContent);
        }

        info('Fetching citation content');
        const citationContent = await getCitationContent(octokit, owner, repo);
        if (citationContent) {
            metadata.citation = citationContent;
            metadata = parseCitationCFF(citationContent, metadata);
            metadata.publication = removeDuplicatePublications(metadata.publication, metadata.citation);
        }

        if (prepare) {
            info('Preparing metadata');
            metadata = PrepareListsIds(metadata);
        }

        info('Sending response');
        res.json({
            data: metadata,
            status: 200,
        });
    } catch (error) {
        error('Error occurred:', error);
        res.status(error.status || 500).json({
            data: null,
            message: error.message || 'An error occurred',
        });
    }
});


/**
 * @openapi
 * /metadata/user:
 *   post:
 *     summary: Fetch metadata from a GitHub repository using the user's access token.
 *     description: >
 *       This endpoint fetches metadata from a GitHub repository using the user's access token.
 *       It performs the following steps:
 *       1. Authenticates the user.
 *       2. Retrieves the repository metadata.
 *       3. Optionally fetches documentation files.
 *       4. Optionally fetches README content.
 *       5. Optionally fetches citation content.
 *       6. Optionally prepares the metadata before sending the response.
 *     tags:
 *       - Metadata Extractor for FAIRsoft
 *     requestBody:
 *       description: Required parameters to fetch the metadata.
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               owner:
 *                 type: string
 *                 description: The owner of the GitHub repository.
 *               repo:
 *                 type: string
 *                 description: The name of the GitHub repository.
 *               userToken:
 *                 type: string
 *                 description: The access token of the GitHub user.
 *               prepare:
 *                 type: boolean
 *                 description: Whether to prepare the repository metadata before returning it.
 *                 default: true
 *     responses:
 *       200:
 *         description: Successfully fetched the repository metadata.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   description: The repository metadata, including documentation, citation, and publication details.
 *                 status:
 *                   type: integer
 *                   example: 200
 *       500:
 *         description: Failed to fetch the repository metadata due to an error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: null
 *                 message:
 *                   type: string
 *                   example: An error occurred
 */
router.post('/metadata/user', async (req, res) => {
    const { owner, repo, userToken, prepare = true } = req.body;

    try {
        console.info('Authenticating user');
        const octokit = await authUser(userToken);

        console.info('User authenticated. Getting repository metadata');
        let metadata = await getRepositoryMetadata(octokit, owner, repo);

        console.info('Fetching documentation files');
        const documentation = await fetchDocumentationFiles(octokit, owner, repo);
        metadata.documentation = documentation;

        console.info('Fetching README content');
        const readmeContent = await getReadmeContent(octokit, owner, repo);
        metadata.publication = extractJournalPublication(readmeContent);

        console.info('Fetching citation content');
        const citationContent = await getCitationContent(octokit, owner, repo);
        if (citationContent) {
            metadata.citation = citationContent;
            metadata = parseCitationCFF(citationContent, metadata);
            metadata.publication = removeDuplicatePublications(metadata.publication, metadata.citation);
        }

        if (prepare) {
            console.info('Preparing metadata');
            metadata = PrepareListsIds(metadata);
        }

        console.info('Sending response');
        res.json({
            data: metadata,
            status: 200,
        });
    } catch (error) {
        console.error('Error occurred:', error);
        res.status(error.status || 500).json({
            data: null,
            message: error.message || 'An error occurred',
        });
    }
});

/**
 * @openapi
 * /metadata/content:
 *   post:
 *     summary: Retrieve the content of a file in a GitHub repository.
 *     description: >
 *       This endpoint retrieves the content of a file in a GitHub repository. The file's content is expected to be in JSON format,
 *       which will be parsed and returned in the response.
 *     tags:
 *       - Metadata Extractor for FAIRsoft
 *     requestBody:
 *       description: Required parameters to fetch the file content.
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               owner:
 *                 type: string
 *                 description: The owner of the GitHub repository.
 *               repo:
 *                 type: string
 *                 description: The name of the GitHub repository.
 *               path:
 *                 type: string
 *                 description: The path to the file in the repository.
 *               installationID:
 *                 type: string
 *                 description: The installation ID of the GitHub App.
 *     responses:
 *       200:
 *         description: Successfully retrieved the content of the specified file.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 code:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: success
 *                 content:
 *                   type: object
 *                   description: The content of the specified file, parsed as a JSON object if applicable.
 *       500:
 *         description: Failed to retrieve the file content due to an error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: integer
 *                   example: 500
 *                 code:
 *                   type: string
 *                   example: INTERNAL_SERVER_ERROR
 *                 message:
 *                   type: string
 *                   example: An error occurred while fetching file content.
 */
router.post('/metadata/content', async (req, res) => {
    console.log('Request received:', req.body);

    const { owner, repo, path, installationID } = req.body;
    console.debug('Parameters:', { owner, repo, path, installationID, ref: 'main' });

    let resp;

    try {
        console.debug('Authenticating app');
        const app = await authApp(MetadataExtractor.appID, MetadataExtractor.privateKeyPath);
        console.debug('App authenticated. Getting installation Octokit.');

        const octokit = await app.getInstallationOctokit(installationID);
        console.debug('Installation Octokit retrieved.');

        const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            owner,
            repo,
            path,
            ref,
            accept: 'application/vnd.github+json'
        });

        console.log('GitHub API request successful.');
        console.debug('Raw file content:', response.data.content);

        let fileContent = Buffer.from(response.data.content, 'base64').toString('utf8');
        
        // if .json extension is present, parse the content as JSON
        if (path.endsWith('.json')) {
             fileContent = JSON.parse(fileContent);
        }

        resp = {
            status: 200,
            code: 200,
            message: 'success',
            content: fileContent
        };
    } catch (error) {
        console.error('Error fetching file content:', error);
        resp = {
            status: error.status || 500,
            code: error.code || 'INTERNAL_SERVER_ERROR',
            message: error.message || 'An error occurred while fetching file content.'
        };
    } finally {
        res.status(resp.status).json(resp);
    }
});


/**
 * @openapi
 * /metadata/content/user:
 *   post:
 *     summary: Fetch file content from a GitHub repository for a specified user.
 *     description: >
 *       This endpoint retrieves the content of a file from a GitHub repository using the user's access token.
 *       The file's content is expected to be in JSON format, which will be parsed and returned in the response if applicable.
 *     tags:
 *       - Metadata Extractor for FAIRsoft
 *     requestBody:
 *       description: Required parameters to fetch the file content.
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               owner:
 *                 type: string
 *                 description: The GitHub username or organization that owns the repository.
 *               repo:
 *                 type: string
 *                 description: The name of the GitHub repository.
 *               path:
 *                 type: string
 *                 description: The file path within the repository to fetch.
 *               userToken:
 *                 type: string
 *                 description: The user's GitHub access token for authentication.
 *     responses:
 *       200:
 *         description: Successfully retrieved the content of the specified file.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 code:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: success
 *                 content:
 *                   type: object
 *                   description: The content of the specified file, parsed as a JSON object if applicable.
 *       500:
 *         description: Failed to retrieve the file content due to an error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: integer
 *                   example: 500
 *                 code:
 *                   type: string
 *                   example: INTERNAL_SERVER_ERROR
 *                 message:
 *                   type: string
 *                   example: An error occurred while fetching file content.
 */
router.post('/metadata/content/user', async (req, res) => {
    console.log('Request received:', req.body);

    const { owner, repo, path, userToken } = req.body;
    console.debug('Parameters:', { owner, repo, path, userToken });

    let resp;

    try {

        console.info('Authenticating user');
        const octokit = await authUser(userToken);

        const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            owner,
            repo,
            path,
            accept: 'application/vnd.github+json'
        });

        console.log('GitHub API request successful.');
        console.debug('Raw file content:', response.data.content);

        let fileContent = Buffer.from(response.data.content, 'base64').toString('utf8');
        
        // if .json extension is present, parse the content as JSON
        if (path.endsWith('.json')) {
             fileContent = JSON.parse(fileContent);
        }

        resp = {
            status: 200,
            code: 200,
            message: 'success',
            content: fileContent
        };
    } catch (error) {
        console.error('Error fetching file content:', error);
        resp = {
            status: error.status || 500,
            code: error.code || 'INTERNAL_SERVER_ERROR',
            message: error.message || 'An error occurred while fetching file content.'
        };
    } finally {
        res.status(resp.status).json(resp);
    }
});

module.exports = router;