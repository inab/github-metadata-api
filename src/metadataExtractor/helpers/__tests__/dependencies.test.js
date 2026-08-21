const fs = require('fs');
const path = require('path');

const {
    fetchDependencies,
    formatEntry,
    normalizeName,
    splitPep508,
    parseRequirementsTxt,
    parsePyprojectToml,
    parseSetupCfg,
    parsePipfile,
    parseEnvironmentYml,
    parsePackageJson,
    parsePackageLockJson,
    parseDescription,
    parseCargoToml,
    parseCargoLock,
    parseGoMod,
    MANIFESTS,
} = require('../dependencies');

const FIXTURES = path.join(__dirname, 'fixtures');
const fixture = (...parts) => fs.readFileSync(path.join(FIXTURES, ...parts), 'utf8');

const pyprojectFixture = fixture('folklore-mcp', 'pyproject.toml');
const requirementsLockFixture = fixture('folklore-mcp', 'requirements.lock');

describe('formatEntry', () => {
    it('renders a constraint in the schema\'s parenthesised form', () => {
        expect(formatEntry('fastapi', '>=0.115.0,<1.0')).toBe('fastapi (>=0.115.0,<1.0)');
    });

    it('leaves an unconstrained dependency bare', () => {
        expect(formatEntry('numpy', '')).toBe('numpy');
        expect(formatEntry('numpy', '*')).toBe('numpy');
    });
});

describe('normalizeName', () => {
    it('folds Python names per PEP 503', () => {
        expect(normalizeName('Pydantic_Settings', 'python')).toBe('pydantic-settings');
        expect(normalizeName('prometheus.client', 'python')).toBe('prometheus-client');
    });

    it('only lowercases for other ecosystems', () => {
        expect(normalizeName('Rcpp', 'r')).toBe('rcpp');
        expect(normalizeName('@Scope/Thing', 'javascript')).toBe('@scope/thing');
    });
});

describe('splitPep508', () => {
    it('strips extras', () => {
        expect(splitPep508('uvicorn[standard]>=0.32.0,<1.0')).toEqual({
            name: 'uvicorn',
            constraint: '>=0.32.0,<1.0',
        });
    });

    it('strips a platform marker but keeps the dependency', () => {
        expect(splitPep508('requests>=2.0 ; python_version < "3.11"')).toEqual({
            name: 'requests',
            constraint: '>=2.0',
        });
    });

    it('drops a dependency gated behind an optional extra', () => {
        expect(splitPep508('pytest>=8.0 ; extra == "dev"')).toBeNull();
    });

    it('recovers a name from a VCS requirement egg fragment', () => {
        expect(splitPep508('git+https://github.com/a/b.git#egg=mypkg')).toEqual({
            name: 'mypkg',
            constraint: '',
        });
    });

    it('gives up on a bare URL that names nothing', () => {
        expect(splitPep508('https://example.com/pkg.tar.gz')).toBeNull();
    });
});

describe('parsePyprojectToml', () => {
    const entries = parsePyprojectToml(pyprojectFixture);

    it('reads the 8 declared runtime dependencies plus the Python requirement', () => {
        expect(entries).toHaveLength(9);
        expect(entries).toContain('Python (>=3.12)');
        expect(entries).toContain('fastapi (>=0.115.0,<1.0)');
        expect(entries).toContain('mcp (==2.0.0)');
    });

    it('strips the [standard] extra from uvicorn', () => {
        expect(entries).toContain('uvicorn (>=0.32.0,<1.0)');
        expect(entries.join(' ')).not.toContain('[standard]');
    });

    it('excludes optional-dependencies and build-system requires', () => {
        for (const excluded of ['pytest', 'pytest-asyncio', 'respx', 'ruff', 'setuptools', 'wheel']) {
            expect(entries.some((entry) => entry.startsWith(excluded))).toBe(false);
        }
    });

    it('reads the Poetry table form, skipping optional and grouped entries', () => {
        const poetry = parsePyprojectToml(fixture('poetry-pyproject.toml.fixture'));
        expect(poetry).toContain('Python (^3.11)');
        expect(poetry).toContain('requests (^2.31)');
        expect(poetry).toContain('pandas (^2.0)');
        expect(poetry.some((entry) => entry.startsWith('extras-only'))).toBe(false);
        expect(poetry.some((entry) => entry.startsWith('pytest'))).toBe(false);
    });
});

describe('parseRequirementsTxt', () => {
    it('reads every pinned package in the rye lock and ignores the comment header', () => {
        const entries = parseRequirementsTxt(requirementsLockFixture);
        expect(entries).toHaveLength(42);
        expect(entries).toContain('fastapi (==0.141.1)');
        expect(entries).toContain('typing-extensions (==4.16.0)');
        expect(entries).toContain('websockets (==17.0.1)');
    });

    it('skips pip directives, hashes and inline comments', () => {
        const entries = parseRequirementsTxt(
            [
                '# a comment',
                '-r base.txt',
                '--index-url https://example.com/simple',
                'flask==2.0  # the web framework',
                'cryptography==41.0 --hash=sha256:abcdef',
            ].join('\n')
        );
        expect(entries).toEqual(['flask (==2.0)', 'cryptography (==41.0)']);
    });
});

describe('parsePackageJson', () => {
    const entries = parsePackageJson(fixture('package.json.fixture'));

    it('takes dependencies and the node engine only', () => {
        expect(entries).toContain('Node.js (>=18)');
        expect(entries).toContain('express (^4.18.2)');
        expect(entries).toContain('@scope/thing (~1.0.0)');
    });

    it('excludes devDependencies and peerDependencies', () => {
        expect(entries.some((entry) => entry.startsWith('jest'))).toBe(false);
        expect(entries.some((entry) => entry.startsWith('react'))).toBe(false);
    });
});

describe('parsePackageLockJson', () => {
    const entries = parsePackageLockJson(fixture('package-lock.json.fixture'));

    it('strips the node_modules prefix and keeps scopes intact', () => {
        expect(entries).toContain('express (==4.18.2)');
        expect(entries).toContain('@scope/thing (==1.0.0)');
    });

    it('skips the root entry, dev and optional packages', () => {
        expect(entries).toHaveLength(2);
        expect(entries.some((entry) => entry.startsWith('jest'))).toBe(false);
        expect(entries.some((entry) => entry.startsWith('fsevents'))).toBe(false);
    });
});

describe('parseDescription', () => {
    const entries = parseDescription(fixture('DESCRIPTION.fixture'));

    it('reads Depends and Imports across continuation lines', () => {
        expect(entries).toContain('R (>= 4.0)');
        expect(entries).toContain('utils');
        expect(entries).toContain('dplyr (>= 1.0.0)');
        expect(entries).toContain('tidyr');
        expect(entries).toContain('Rcpp');
    });

    it('excludes Suggests', () => {
        expect(entries.some((entry) => entry.startsWith('testthat'))).toBe(false);
    });
});

describe('parseCargoToml', () => {
    const entries = parseCargoToml(fixture('Cargo.toml.fixture'));

    it('reads [dependencies] in both the string and table forms', () => {
        expect(entries).toContain('Rust (>=1.75)');
        expect(entries).toContain('serde (1.0)');
        expect(entries).toContain('tokio (1.35)');
    });

    it('excludes optional, dev and build dependencies', () => {
        for (const excluded of ['extra-thing', 'criterion', 'cc']) {
            expect(entries.some((entry) => entry.startsWith(excluded))).toBe(false);
        }
    });
});

describe('parseGoMod', () => {
    const entries = parseGoMod(fixture('go.mod.fixture'));

    it('reads the require block, single-line require and go directive', () => {
        expect(entries).toContain('Go (>=1.22)');
        expect(entries).toContain('github.com/spf13/cobra (==v1.8.0)');
        expect(entries).toContain('github.com/stretchr/testify (==v1.9.0)');
    });

    it('keeps indirect modules, since lock contents are merged anyway', () => {
        expect(entries).toContain('golang.org/x/text (==v0.14.0)');
    });

    it('ignores replace blocks', () => {
        expect(entries.some((entry) => entry.includes('good/pkg'))).toBe(false);
    });
});

describe('parseSetupCfg, parsePipfile, parseEnvironmentYml, parseCargoLock', () => {
    it('reads install_requires and python_requires from setup.cfg', () => {
        const entries = parseSetupCfg(
            ['[metadata]', 'name = demo', '[options]', 'python_requires = >=3.9', 'install_requires =', '    numpy>=1.20', '    scipy'].join('\n')
        );
        expect(entries).toEqual(['Python (>=3.9)', 'numpy (>=1.20)', 'scipy']);
    });

    it('reads [packages] from a Pipfile', () => {
        const entries = parsePipfile('[packages]\nrequests = "*"\nflask = ">=2.0"\n\n[dev-packages]\npytest = "*"\n');
        expect(entries).toEqual(['requests', 'flask (>=2.0)']);
        expect(entries.some((entry) => entry.startsWith('pytest'))).toBe(false);
    });

    it('reads a conda environment including its nested pip list', () => {
        const entries = parseEnvironmentYml(
            ['name: demo', 'dependencies:', '  - python=3.11', '  - numpy', '  - pip:', '    - fastapi>=0.1'].join('\n')
        );
        expect(entries).toContain('Python (=3.11)');
        expect(entries).toContain('numpy');
        expect(entries).toContain('fastapi (>=0.1)');
    });

    it('reads [[package]] entries from a Cargo.lock', () => {
        const entries = parseCargoLock('[[package]]\nname = "serde"\nversion = "1.0.195"\n\n[[package]]\nname = "libc"\nversion = "0.2.152"\n');
        expect(entries).toEqual(['serde (==1.0.195)', 'libc (==0.2.152)']);
    });
});

describe('robustness', () => {
    const parsers = {
        parseRequirementsTxt,
        parsePyprojectToml,
        parseSetupCfg,
        parsePipfile,
        parseEnvironmentYml,
        parsePackageJson,
        parsePackageLockJson,
        parseDescription,
        parseCargoToml,
        parseCargoLock,
        parseGoMod,
    };

    for (const [name, parse] of Object.entries(parsers)) {
        it(`${name} returns [] for empty, blank and malformed input`, () => {
            for (const input of ['', '\n\n', '{{{ not valid @@@ ][', null, undefined]) {
                expect(parse(input)).toEqual([]);
            }
        });
    }
});

describe('fetchDependencies', () => {
    const blob = (text) => ({ text: text, byteSize: text.length, isTruncated: false });

    const octokitReturning = (repository) => ({
        graphql: jest.fn().mockResolvedValue({ repository: repository }),
    });

    const aliasFor = (manifestPath) => `f${MANIFESTS.findIndex((m) => m.path === manifestPath)}`;

    it('merges the manifest and the lock, deduplicated, for folklore-mcp', async () => {
        const octokit = octokitReturning({
            [aliasFor('pyproject.toml')]: blob(pyprojectFixture),
            [aliasFor('requirements.lock')]: blob(requirementsLockFixture),
        });

        const dependencies = await fetchDependencies(octokit, 'helena-bioinformatics', 'folklore-mcp');

        // 42 distinct packages in the lock, all 8 manifest names among them, + Python.
        expect(dependencies).toHaveLength(43);
        expect(octokit.graphql).toHaveBeenCalledTimes(1);

        // The runtime requirement leads.
        expect(dependencies[0]).toBe('Python (>=3.12)');

        // The manifest's declared range outranks the lock's exact pin.
        expect(dependencies).toContain('fastapi (>=0.115.0,<1.0)');
        expect(dependencies).not.toContain('fastapi (==0.141.1)');

        // A lock-only transitive package still comes through.
        expect(dependencies).toContain('typing-extensions (==4.16.0)');

        // Extras never leak into the output.
        expect(dependencies).toContain('uvicorn (>=0.32.0,<1.0)');
    });

    it('emits plain strings, sorted deterministically, with no duplicates', async () => {
        const octokit = octokitReturning({
            [aliasFor('pyproject.toml')]: blob(pyprojectFixture),
            [aliasFor('requirements.lock')]: blob(requirementsLockFixture),
        });

        const dependencies = await fetchDependencies(octokit, 'o', 'r');

        expect(dependencies.every((entry) => typeof entry === 'string')).toBe(true);
        expect(new Set(dependencies).size).toBe(dependencies.length);

        const packages = dependencies.slice(1);
        expect(packages).toEqual([...packages].sort());
    });

    it('merges across ecosystems in one request', async () => {
        const octokit = octokitReturning({
            [aliasFor('package.json')]: blob(fixture('package.json.fixture')),
            [aliasFor('go.mod')]: blob(fixture('go.mod.fixture')),
        });

        const dependencies = await fetchDependencies(octokit, 'o', 'r');

        expect(octokit.graphql).toHaveBeenCalledTimes(1);
        expect(dependencies).toContain('express (^4.18.2)');
        expect(dependencies).toContain('github.com/spf13/cobra (==v1.8.0)');
        expect(dependencies.slice(0, 2)).toEqual(['Go (>=1.22)', 'Node.js (>=18)']);
    });

    it('returns [] when the repository has no manifests', async () => {
        const octokit = octokitReturning({});
        await expect(fetchDependencies(octokit, 'o', 'r')).resolves.toEqual([]);
    });

    it('skips truncated and oversized blobs', async () => {
        const octokit = octokitReturning({
            [aliasFor('pyproject.toml')]: { text: pyprojectFixture, byteSize: 5000000, isTruncated: false },
            [aliasFor('requirements.lock')]: { text: requirementsLockFixture, byteSize: 100, isTruncated: true },
        });

        await expect(fetchDependencies(octokit, 'o', 'r')).resolves.toEqual([]);
    });

    it('lets healthy manifests through when one is malformed', async () => {
        const octokit = octokitReturning({
            [aliasFor('pyproject.toml')]: blob('[project\nthis is not toml'),
            [aliasFor('package.json')]: blob(fixture('package.json.fixture')),
        });

        const dependencies = await fetchDependencies(octokit, 'o', 'r');
        expect(dependencies).toContain('express (^4.18.2)');
    });

    it('resolves to [] rather than throwing when the GraphQL call fails', async () => {
        const octokit = { graphql: jest.fn().mockRejectedValue(new Error('boom')) };
        await expect(fetchDependencies(octokit, 'o', 'r')).resolves.toEqual([]);
    });
});
