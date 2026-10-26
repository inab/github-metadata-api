/*
Route tests for the Metadata Updater, one case per request in the team's Insomnia
collection (named after it), plus the branches those requests don't cover.

GitHub is replaced by an in-memory fake at the auth boundary (see
src/shared/testing/fakeGitHub.js): no branch, commit or pull request is ever created.
*/

jest.mock('../../shared/helpers/auth');

const request = require('supertest');
const { authApp } = require('../../shared/helpers/auth');
const { buildRepo, fakeApp, fakeOctokit } = require('../../shared/testing/fakeGitHub');
const app = require('../../app');

const UPDATER_INSTALLATION = 54378821;
const OEB_INSTALLATION = 55475700;

let octokit;

function setup(repos) {
    octokit = fakeOctokit(repos);
    authApp.mockResolvedValue(fakeApp({
        octokit: octokit,
        installations: {
            'evamart/vue-fixed-scroll-break': UPDATER_INSTALLATION,
            'inab/oeb-visualizations': OEB_INSTALLATION,
        },
    }));
}

beforeAll(() => {
    for (const method of ['log', 'info', 'debug', 'warn', 'error']) {
        jest.spyOn(console, method).mockImplementation(() => {});
    }
});

beforeEach(() => {
    setup([
        buildRepo({ owner: 'evamart', repo: 'vue-fixed-scroll-break' }),
        buildRepo({ owner: 'inab', repo: 'oeb-visualizations' }),
    ]);
});

afterEach(() => {
    jest.clearAllMocks();
});

const callsTo = (route) => octokit.calls.filter((call) => call.route === route).map((call) => call.params);

describe('GET /metadata-updater-for-fairsoft/installation/id', () => {
    test.each([
        ['installation ID', 'evamart', 'vue-fixed-scroll-break', UPDATER_INSTALLATION],
        ['installation ID prod', 'inab', 'oeb-visualizations', OEB_INSTALLATION],
    ])('%s: returns the installation for %s/%s', async (_name, owner, repo, id) => {
        const res = await request(app)
            .get('/metadata-updater-for-fairsoft/installation/id')
            .query({ owner: owner, repo: repo });

        expect(res.status).toBe(200);
        expect(res.body.data.data.id).toBe(id);
    });

    it('reports 404 for a repo where the app is not installed', async () => {
        const res = await request(app)
            .get('/metadata-updater-for-fairsoft/installation/id')
            .query({ owner: 'someone', repo: 'not-installed' });

        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ data: null, status: 404 });
    });
});

describe('POST /metadata/pull', () => {
    const body = {
        owner: 'evamart',
        repo: 'vue-fixed-scroll-break',
        filename: 'test.md',
        installationID: UPDATER_INSTALLATION,
        metadata: 'This is the content of the test file',
        title: 'test PR',
        message: 'This is a PR by Metadata Updater',
    };

    it('metadata/pull: branches from main, commits the file and opens a PR', async () => {
        const res = await request(app).post('/metadata/pull').send(body);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            status: 200,
            message: 'success',
            new_branch_name: 'evaluator-1',
            head_branch_name: 'main',
            url: 'https://github.com/evamart/vue-fixed-scroll-break/pull/1',
        });

        expect(callsTo('POST /repos/{owner}/{repo}/git/refs')).toEqual([
            expect.objectContaining({ ref: 'refs/heads/evaluator-1', sha: 'sha-main' }),
        ]);

        const [commit] = callsTo('PUT /repos/{owner}/{repo}/contents/{path}');
        expect(commit).toMatchObject({ path: 'test.md', branch: 'evaluator-1', message: body.message });
        expect(Buffer.from(commit.content, 'base64').toString('utf8')).toBe(body.metadata);
        expect(commit.sha).toBeUndefined();

        expect(callsTo('POST /repos/{owner}/{repo}/pulls')).toEqual([
            expect.objectContaining({ head: 'evaluator-1', base: 'main', title: 'test PR', body: body.message }),
        ]);
    });

    it('picks the next free evaluator-N branch name', async () => {
        setup([buildRepo({
            owner: 'evamart',
            repo: 'vue-fixed-scroll-break',
            branches: ['main', 'evaluator', 'evaluator-2'],
        })]);

        const res = await request(app).post('/metadata/pull').send(body);

        expect(res.body.new_branch_name).toBe('evaluator-3');
    });

    it('targets the requested branch', async () => {
        setup([buildRepo({ owner: 'evamart', repo: 'vue-fixed-scroll-break', branches: ['master'] })]);

        const res = await request(app).post('/metadata/pull').send({ ...body, branch: 'master' });

        expect(res.body.head_branch_name).toBe('master');
        expect(callsTo('POST /repos/{owner}/{repo}/pulls')[0].base).toBe('master');
    });

    it('uses the default title and message when none are given', async () => {
        const { title, message, ...rest } = body;
        await request(app).post('/metadata/pull').send(rest);

        const [pull] = callsTo('POST /repos/{owner}/{repo}/pulls');
        expect(pull.title).toBe('Metadata/Citation for this software');
        expect(pull.body).toMatch(/^Description of this software \(`test.md`\) generated by/);
    });

    it('updates the file in place when it already exists', async () => {
        setup([buildRepo({
            owner: 'evamart',
            repo: 'vue-fixed-scroll-break',
            files: { 'test.md': 'old content' },
        })]);

        await request(app).post('/metadata/pull').send(body);

        expect(callsTo('PUT /repos/{owner}/{repo}/contents/{path}')[0].sha).toBe('sha-test.md');
    });

    it('reports the error and creates nothing when the target branch does not exist', async () => {
        const res = await request(app).post('/metadata/pull').send({ ...body, branch: 'nope' });

        // Errors stay HTTP 200 with the status in `code`: the Evaluator front end reads
        // the body and breaks on a non-2xx response.
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ code: 404, message: 'Branch not found' });
        expect(octokit.calls).toEqual([]);
    });

    it('reports code 500 when the installation cannot be authenticated', async () => {
        const res = await request(app).post('/metadata/pull').send({ ...body, installationID: 1 });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ code: 500, message: 'Failed to get Octokit instance for installation' });
    });
});
