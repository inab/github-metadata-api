/*
In-memory stand-in for the GitHub API, used by the route tests.

The routes only ever reach GitHub through the octokit returned by authApp/authUser,
so tests mock src/shared/helpers/auth to hand back fakeApp()/fakeOctokit() and no
request leaves the process. The fake answers the GraphQL queries and REST routes the
helpers actually send, and throws a 404 for anything it does not know, so a test fails
loudly if a helper starts calling something new.

Not under __tests__ on purpose: Jest would try to run it as a test suite.
*/

/**
 * Builds an error shaped like the ones Octokit throws for HTTP failures.
 */
function httpError(status, message) {
    return Object.assign(new Error(message), { status: status });
}

/**
 * Builds a repository fixture. Everything is overridable; the defaults describe a
 * small public repo with one release, one topic, one contributor and an MIT license.
 *
 * @param {Object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {Object<string, string>} [options.files] - Repo-root-relative path → text content.
 * @param {string[]} [options.branches] - Branch names; the first one is the default branch.
 * @param {Object} [options.repository] - Fields merged into the GraphQL repository object.
 */
function buildRepo({ owner, repo, files = {}, branches = ['main'], repository = {} }) {
    return {
        owner: owner,
        repo: repo,
        files: files,
        branches: branches,
        repository: {
            name: repo,
            description: `${repo} description`,
            descriptionHTML: `<div>${repo} description</div>`,
            homepageUrl: null,
            isDisabled: false,
            isEmpty: false,
            isFork: false,
            isInOrganization: false,
            isLocked: false,
            isMirror: false,
            isPrivate: false,
            isTemplate: false,
            latestRelease: { name: 'v1.0.0', tagName: 'v1.0.0' },
            licenseInfo: {
                id: 'MDc6TGljZW5zZTEz',
                name: 'MIT License',
                spdxId: 'MIT',
                url: 'http://choosealicense.com/licenses/mit/',
            },
            mirrorUrl: null,
            packages: { nodes: [] },
            releases: {
                nodes: [{ id: 'RE_1', tagName: 'v1.0.0', name: 'v1.0.0', url: `https://github.com/${owner}/${repo}/releases/tag/v1.0.0` }],
            },
            url: `https://github.com/${owner}/${repo}`,
            defaultBranchRef: {
                target: {
                    history: {
                        edges: [
                            { node: { author: { name: 'Ada Lovelace', email: 'ada@example.org', user: { login: 'ada' } } } },
                            { node: { author: { name: 'Ada Lovelace', email: 'ada@example.org', user: { login: 'ada' } } } },
                        ],
                    },
                },
            },
            repositoryTopics: {
                nodes: [{ url: 'https://github.com/topics/vue', topic: { id: 'MDU6VG9waWMx', name: 'vue' } }],
            },
            ...repository,
        },
    };
}

/**
 * Lists the entries directly under `dir` ('' for the root), the way a GraphQL Tree does.
 */
function treeEntries(fixture, dir) {
    const prefix = dir ? `${dir}/` : '';
    const entries = new Map();

    for (const path of Object.keys(fixture.files)) {
        if (!path.startsWith(prefix)) continue;
        const [name, ...rest] = path.slice(prefix.length).split('/');
        entries.set(name, rest.length > 0 ? 'tree' : 'blob');
    }

    return entries.size > 0
        ? [...entries].map(([name, type]) => ({ name: name, type: type }))
        : null;
}

function blob(text) {
    return { text: text, byteSize: Buffer.byteLength(text), isTruncated: false };
}

/**
 * Creates a fake octokit over a set of repository fixtures.
 *
 * `calls` records every mutating REST request so tests can assert on what would
 * have been written to GitHub.
 *
 * @param {Object[]} repos - Fixtures from buildRepo().
 */
function fakeOctokit(repos) {
    const find = (owner, repo) => repos.find((r) => r.owner === owner && r.repo === repo);
    const calls = [];

    async function graphql(query, variables) {
        const fixture = find(variables.owner, variables.repo);
        if (!fixture) {
            throw new Error(`Could not resolve to a Repository with the name '${variables.owner}/${variables.repo}'.`);
        }

        // queryRepositoryObject
        if (query.includes('licenseInfo')) {
            return { repository: fixture.repository };
        }

        // fetchManifestBlobs: one aliased object(expression: "HEAD:<path>") per manifest
        if (query.includes('fragment ManifestBlob')) {
            const repository = {};
            for (const [, alias, path] of query.matchAll(/(f\d+): object\(expression: "HEAD:(.+?)"\)/g)) {
                const text = fixture.files[path];
                repository[alias] = text === undefined ? null : blob(text);
            }
            return { repository: repository };
        }

        // fetchDirectoryContentsGraphQL
        if (query.includes('... on Tree')) {
            const entries = treeEntries(fixture, variables.path.replace(/^HEAD:/, ''));
            return { repository: { object: entries ? { entries: entries } : null } };
        }

        // getReadmeContent / getCitationContent
        const single = query.match(/object\(expression: "HEAD:(.+?)"\)/);
        if (single) {
            const text = fixture.files[single[1]];
            return { repository: { object: text === undefined ? null : { text: text } } };
        }

        throw new Error(`fakeOctokit: unexpected GraphQL query:\n${query}`);
    }

    async function request(route, params = {}) {
        const fixture = find(params.owner, params.repo);
        if (!fixture) {
            throw httpError(404, 'Not Found');
        }

        switch (route) {
            case 'GET /repos/{owner}/{repo}/contents/{path}': {
                const text = fixture.files[params.path];
                if (text === undefined) throw httpError(404, 'Not Found');
                return {
                    status: 200,
                    data: {
                        path: params.path,
                        sha: `sha-${params.path}`,
                        encoding: 'base64',
                        content: Buffer.from(text).toString('base64'),
                    },
                };
            }

            case 'GET /repos/{owner}/{repo}/branches/{branch}':
                if (!fixture.branches.includes(params.branch)) throw httpError(404, 'Branch not found');
                return { status: 200, data: { name: params.branch, commit: { sha: `sha-${params.branch}` } } };

            case 'GET /repos/{owner}/{repo}/branches':
                return { status: 200, data: fixture.branches.map((name) => ({ name: name })) };

            case 'POST /repos/{owner}/{repo}/git/refs':
                calls.push({ route: route, params: params });
                fixture.branches.push(params.ref.replace(/^refs\/heads\//, ''));
                return { status: 201, data: { ref: params.ref, object: { sha: params.sha } } };

            case 'PUT /repos/{owner}/{repo}/contents/{path}':
                calls.push({ route: route, params: params });
                return { status: params.sha ? 200 : 201, data: { content: { path: params.path } } };

            case 'POST /repos/{owner}/{repo}/pulls':
                calls.push({ route: route, params: params });
                return {
                    status: 201,
                    data: { number: 1, html_url: `https://github.com/${params.owner}/${params.repo}/pull/1` },
                };

            default:
                throw new Error(`fakeOctokit: unexpected REST route ${route}`);
        }
    }

    return { graphql: graphql, request: request, calls: calls };
}

/**
 * Creates a fake GitHub App, as returned by authApp().
 *
 * @param {Object} options
 * @param {Object} options.octokit - The installation octokit, from fakeOctokit().
 * @param {Object<string, number>} options.installations - 'owner/repo' → installation ID.
 */
function fakeApp({ octokit, installations }) {
    return {
        // getInstallationID requests the literal URL, not a route template.
        octokit: {
            request: async (url) => {
                const match = url.match(/^\/repos\/([^/]+)\/([^/]+)\/installation$/);
                const id = match && installations[`${match[1]}/${match[2]}`];
                if (!id) throw httpError(404, 'Not Found');
                return { status: 200, data: { id: id, account: { login: match[1] } } };
            },
        },
        getInstallationOctokit: async (installationID) => {
            if (!Object.values(installations).includes(installationID)) {
                throw httpError(404, 'Not Found');
            }
            return octokit;
        },
    };
}

module.exports = {
    buildRepo,
    fakeApp,
    fakeOctokit,
    httpError,
};
