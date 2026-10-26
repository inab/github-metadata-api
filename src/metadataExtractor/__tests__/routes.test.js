/*
Route tests for the Metadata Extractor, one case per request in the team's Insomnia
collection (named after it), plus the error paths those requests don't cover.

GitHub is replaced by an in-memory fake at the auth boundary (see
src/shared/testing/fakeGitHub.js), so these run without network or credentials.
*/

jest.mock('../../shared/helpers/auth');

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { authApp, authUser } = require('../../shared/helpers/auth');
const { buildRepo, fakeApp, fakeOctokit } = require('../../shared/testing/fakeGitHub');
const app = require('../../app');

const EXTRACTOR_INSTALLATION = 54379072;
const OEB_INSTALLATION = 55475654;
const USER_TOKEN = 'ghp_placeholder_test_token';

const fixture = (...parts) =>
    fs.readFileSync(path.join(__dirname, '../helpers/__tests__/fixtures', ...parts), 'utf8');

const README = `# vue-fixed-scroll-break

Fixes a scroll break in Vue.

\`\`\`bibtex
@article{lovelace2024,
  title = {{Scroll breaks considered harmful}},
  year = {2024},
  doi = {10.1234/scroll.5678},
  url = {https://example.org/scroll}
}
\`\`\`
`;

const PACKAGE_JSON = JSON.stringify({
    name: 'vue-fixed-scroll-break',
    engines: { node: '>=14' },
    dependencies: { vue: '^2.6.0' },
    devDependencies: { jest: '^29.0.0' },
});

const CITATION_CFF = `cff-version: 1.2.0
title: Vue Fixed Scroll Break
version: 2.0.0
license: MIT
authors:
  - given-names: Grace
    family-names: Hopper
`;

const PYMUT_METADATA = JSON.stringify({ name: 'pymut', version: '0.1.0' });

let octokit;

beforeAll(() => {
    // The routes log every request and response body; keep the test output readable.
    for (const method of ['log', 'info', 'debug', 'warn', 'error']) {
        jest.spyOn(console, method).mockImplementation(() => {});
    }
});

beforeEach(() => {
    octokit = fakeOctokit([
        buildRepo({
            owner: 'evamart',
            repo: 'vue-fixed-scroll-break',
            files: {
                'README.md': README,
                'package.json': PACKAGE_JSON,
                'LICENSE': 'MIT License',
                'docs/USAGE.md': '# Usage',
            },
        }),
        buildRepo({
            owner: 'inab',
            repo: 'oeb-visualizations',
            files: { 'pymut.metadata.json': PYMUT_METADATA },
        }),
        buildRepo({ owner: 'Bioconductor-mirror', repo: 'dzerbino' }),
        buildRepo({
            owner: 'helena-bioinformatics',
            repo: 'folklore-mcp',
            files: { 'pyproject.toml': fixture('folklore-mcp', 'pyproject.toml') },
        }),
        buildRepo({ owner: 'inab', repo: 'observatory-api' }),
    ]);

    authApp.mockResolvedValue(fakeApp({
        octokit: octokit,
        installations: {
            'evamart/vue-fixed-scroll-break': EXTRACTOR_INSTALLATION,
            'inab/oeb-visualizations': OEB_INSTALLATION,
        },
    }));
    authUser.mockResolvedValue(octokit);
});

afterEach(() => {
    jest.clearAllMocks();
});

const terms = (list) => list.map((item, index) => ({ term: item, id: index }));

describe('GET /metadata-extractor-for-fairsoft/installation/id', () => {
    it('installation ID: returns the installation for evamart/vue-fixed-scroll-break', async () => {
        const res = await request(app)
            .get('/metadata-extractor-for-fairsoft/installation/id')
            .query({ owner: 'evamart', repo: 'vue-fixed-scroll-break' });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe(200);
        expect(res.body.data.data.id).toBe(EXTRACTOR_INSTALLATION);
    });

    it('reports 404 for a repo where the app is not installed', async () => {
        const res = await request(app)
            .get('/metadata-extractor-for-fairsoft/installation/id')
            .query({ owner: 'someone', repo: 'not-installed' });

        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ data: null, status: 404 });
    });
});

describe('POST /metadata', () => {
    const body = {
        owner: 'evamart',
        repo: 'vue-fixed-scroll-break',
        installationID: EXTRACTOR_INSTALLATION,
    };

    it('evamart/vue-fixed-scroll-break: returns prepared metadata', async () => {
        const res = await request(app).post('/metadata').send(body);

        expect(res.status).toBe(200);
        expect(authApp).toHaveBeenCalledTimes(1);

        const { data } = res.body;
        expect(data.name).toBe('vue-fixed-scroll-break');
        expect(data.label).toEqual(['vue-fixed-scroll-break']);
        expect(data.description).toEqual(terms(['vue-fixed-scroll-break description']));
        expect(data.repository).toEqual(terms(['https://github.com/evamart/vue-fixed-scroll-break']));
        expect(data.license).toEqual(terms([{ name: 'MIT License', url: 'http://choosealicense.com/licenses/mit/' }]));
        expect(data.version).toEqual(['v1.0.0']);
        expect(data.authors).toEqual(terms([
            { name: 'Ada Lovelace', type: 'person', email: 'ada@example.org', maintainer: false },
        ]));
        expect(data.dependencies).toEqual(terms(['Node.js (>=14)', 'vue (^2.6.0)']));
        expect(data.documentation).toEqual(terms([
            { type: 'readme', url: 'https://github.com/evamart/vue-fixed-scroll-break/blob/HEAD/README.md' },
            { type: 'usage', url: 'https://github.com/evamart/vue-fixed-scroll-break/blob/HEAD/docs/USAGE.md' },
        ]));
        // readme_extract defaults to false on the app-authenticated route.
        expect(data.publication).toEqual([]);
    });

    it('returns the raw list shape when prepare is false', async () => {
        const res = await request(app).post('/metadata').send({ ...body, prepare: false });

        expect(res.status).toBe(200);
        expect(res.body.data.description).toEqual(['vue-fixed-scroll-break description']);
        expect(res.body.data.dependencies).toEqual(['Node.js (>=14)', 'vue (^2.6.0)']);
    });

    it('skips dependency extraction when dependencies_extract is false', async () => {
        const res = await request(app)
            .post('/metadata')
            .send({ ...body, prepare: false, dependencies_extract: false });

        expect(res.status).toBe(200);
        expect(res.body.data.dependencies).toEqual([]);
    });

    it('extracts BibTeX publications from the README when readme_extract is true', async () => {
        const res = await request(app)
            .post('/metadata')
            .send({ ...body, prepare: false, readme_extract: true });

        expect(res.status).toBe(200);
        expect(res.body.data.publication).toEqual([{
            title: 'Scroll breaks considered harmful',
            year: '2024',
            doi: '10.1234/scroll.5678',
            url: 'https://example.org/scroll',
        }]);
    });

    it('merges CITATION.cff into the metadata', async () => {
        octokit = fakeOctokit([buildRepo({
            owner: 'evamart',
            repo: 'vue-fixed-scroll-break',
            files: { 'CITATION.cff': CITATION_CFF },
        })]);
        authApp.mockResolvedValue(fakeApp({
            octokit: octokit,
            installations: { 'evamart/vue-fixed-scroll-break': EXTRACTOR_INSTALLATION },
        }));

        const res = await request(app).post('/metadata').send({ ...body, prepare: false });

        expect(res.status).toBe(200);
        const { data } = res.body;
        expect(data.citation).toBe(CITATION_CFF);
        expect(data.label).toEqual(['vue-fixed-scroll-break', 'Vue Fixed Scroll Break']);
        expect(data.version).toEqual(['v1.0.0', '2.0.0']);
        expect(data.authors).toEqual([
            { name: 'Grace Hopper', email: '', maintainer: false, type: 'person' },
        ]);
    });

    it('responds 404 for an unknown installation', async () => {
        const res = await request(app)
            .post('/metadata')
            .send({ ...body, installationID: 1 })
            .timeout(1000);

        expect(res.status).toBe(404);
        expect(res.body.data).toBeNull();
    });
});

describe('POST /metadata/user', () => {
    // The four /metadata/user requests in the collection, all sent with prepare: false.
    // ("evamart/vue-fixed-scroll-break prepare" also sends prepare: false despite its name.)
    test.each([
        ['New Request', 'Bioconductor-mirror', 'dzerbino'],
        ['evamart/vue-fixed-scroll-break non prepare', 'helena-bioinformatics', 'folklore-mcp'],
        ['evamart/vue-fixed-scroll-break prepare', 'helena-bioinformatics', 'folklore-mcp'],
        ['curl evamart/vue-fixed-scroll-break non prepare', 'inab', 'observatory-api'],
    ])('%s: returns raw metadata for %s/%s', async (_name, owner, repo) => {
        const res = await request(app)
            .post('/metadata/user')
            .send({ owner: owner, repo: repo, userToken: USER_TOKEN, prepare: false });

        expect(res.status).toBe(200);
        expect(authUser).toHaveBeenCalledWith(USER_TOKEN);

        const { data } = res.body;
        expect(data.name).toBe(repo);
        expect(data.description).toEqual([`${repo} description`]);
        expect(data.repository).toEqual([`https://github.com/${owner}/${repo}`]);
        expect(Array.isArray(data.dependencies)).toBe(true);
        data.dependencies.forEach((dependency) => expect(typeof dependency).toBe('string'));
    });

    it('extracts dependencies from pyproject.toml for helena-bioinformatics/folklore-mcp', async () => {
        const res = await request(app)
            .post('/metadata/user')
            .send({ owner: 'helena-bioinformatics', repo: 'folklore-mcp', userToken: USER_TOKEN, prepare: false });

        expect(res.status).toBe(200);
        expect(res.body.data.dependencies.length).toBeGreaterThan(0);
        expect(res.body.data.dependencies[0]).toMatch(/^Python \(/);
    });

    it('returns prepared metadata by default', async () => {
        const res = await request(app)
            .post('/metadata/user')
            .send({ owner: 'evamart', repo: 'vue-fixed-scroll-break', userToken: USER_TOKEN });

        expect(res.status).toBe(200);
        expect(res.body.data.dependencies).toEqual(terms(['Node.js (>=14)', 'vue (^2.6.0)']));
    });

    it('always extracts README publications on the user-token route', async () => {
        const res = await request(app)
            .post('/metadata/user')
            .send({ owner: 'evamart', repo: 'vue-fixed-scroll-break', userToken: USER_TOKEN, prepare: false });

        expect(res.body.data.publication).toHaveLength(1);
        expect(res.body.data.publication[0].doi).toBe('10.1234/scroll.5678');
    });

    it('responds 500 with a message when the repository does not exist', async () => {
        const res = await request(app)
            .post('/metadata/user')
            .send({ owner: 'evamart', repo: 'does-not-exist', userToken: USER_TOKEN });

        expect(res.status).toBe(500);
        expect(res.body.data).toBeNull();
        expect(res.body.message).toMatch(/does-not-exist/);
    });
});

describe('POST /metadata/content', () => {
    test.each([
        ['vue-fixed-scroll-break package.json extraction', 'evamart', 'vue-fixed-scroll-break', 'package.json', EXTRACTOR_INSTALLATION, JSON.parse(PACKAGE_JSON)],
        ['vue-fixed-scroll-break README extraction', 'evamart', 'vue-fixed-scroll-break', 'README.md', EXTRACTOR_INSTALLATION, README],
        ['pymut.metadata.jsonld', 'inab', 'oeb-visualizations', 'pymut.metadata.json', OEB_INSTALLATION, JSON.parse(PYMUT_METADATA)],
    ])('%s', async (_name, owner, repo, filePath, installationID, expected) => {
        const res = await request(app)
            .post('/metadata/content')
            .send({ owner: owner, repo: repo, path: filePath, installationID: installationID });

        expect(res.status).toBe(200);
        expect(res.body.content).toEqual(expected);
    });

    it('responds 404 for a file that does not exist', async () => {
        const res = await request(app)
            .post('/metadata/content')
            .send({ owner: 'evamart', repo: 'vue-fixed-scroll-break', path: 'nope.md', installationID: EXTRACTOR_INSTALLATION });

        expect(res.status).toBe(404);
    });
});

describe('POST /metadata/content/user', () => {
    // Both requests in the collection fetch README.md (one is misnamed "package.json extraction").
    test.each([
        ['vue-fixed-scroll-break README extraction'],
        ['vue-fixed-scroll-break package.json extraction'],
    ])('%s: returns README.md as text', async () => {
        const res = await request(app)
            .post('/metadata/content/user')
            .send({ owner: 'evamart', repo: 'vue-fixed-scroll-break', path: 'README.md', userToken: USER_TOKEN });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 200, code: 200, message: 'success', content: README });
    });

    it('parses .json files', async () => {
        const res = await request(app)
            .post('/metadata/content/user')
            .send({ owner: 'evamart', repo: 'vue-fixed-scroll-break', path: 'package.json', userToken: USER_TOKEN });

        expect(res.status).toBe(200);
        expect(res.body.content).toEqual(JSON.parse(PACKAGE_JSON));
    });

    it('responds 404 for a file that does not exist', async () => {
        const res = await request(app)
            .post('/metadata/content/user')
            .send({ owner: 'evamart', repo: 'vue-fixed-scroll-break', path: 'nope.md', userToken: USER_TOKEN });

        expect(res.status).toBe(404);
        expect(res.body.status).toBe(404);
    });
});
