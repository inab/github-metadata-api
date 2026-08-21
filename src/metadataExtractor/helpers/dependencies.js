const TOML = require('@iarna/toml');
const yaml = require('js-yaml');
var info = require('debug')('node-api:info');

/*
Extracts the declared dependencies of a repository from the package manifests and
lock files found at the root of its default branch.

Every parser here is pure (text -> array of strings) so it can be unit tested without
touching the network. The strings follow the Observatory schema, which types
`dependencies` as an array of plain strings with the version constraint inline,
e.g. "R (>= 4.0)". See software_instance.schema.json in research-software-etl.
*/

// GitHub truncates large blobs, and a multi-megabyte lock file is not worth parsing.
const MAX_BLOB_BYTES = 1000000;

// Language/runtime requirements are listed ahead of the package entries.
const RUNTIME_NAMES = new Set(['python', 'node.js', 'go', 'rust', 'r']);

/**
 * Builds the canonical string for one dependency: "name (constraint)", or a bare
 * "name" when the manifest declares no constraint.
 *
 * @param {string} name - The package name as declared.
 * @param {string} [constraint] - The version constraint, in the manifest's own syntax.
 * @returns {string} - The dependency in Observatory string form.
 */
function formatEntry(name, constraint) {
    const cleanName = String(name == null ? '' : name).trim();
    const cleanConstraint = String(constraint == null ? '' : constraint).trim();

    if (!cleanName) {
        return '';
    }

    // "*" is how Pipfile and conda spell "any version".
    if (!cleanConstraint || cleanConstraint === '*') {
        return cleanName;
    }

    return `${cleanName} (${cleanConstraint})`;
}

/**
 * Normalises a package name for use as a deduplication key. Python names are
 * additionally folded per PEP 503, so `prometheus_client` and `prometheus-client`
 * count as one package.
 *
 * @param {string} name - The package name.
 * @param {string} ecosystem - The ecosystem the name came from.
 * @returns {string} - The normalised key.
 */
function normalizeName(name, ecosystem) {
    const lowered = String(name == null ? '' : name).trim().toLowerCase();
    return ecosystem === 'python' ? lowered.replace(/[-_.]+/g, '-') : lowered;
}

/**
 * Recovers the package name from an already formatted entry.
 *
 * @param {string} entry - An entry produced by formatEntry.
 * @returns {string} - The name, without its constraint.
 */
function baseName(entry) {
    return String(entry).split(' (')[0].trim();
}

/**
 * Builds the deduplication key for an entry. The key is scoped by ecosystem so that
 * two unrelated packages that happen to share a name stay distinct. Internal only:
 * it is never emitted, so it cannot fragment the Observatory's aggregation.
 *
 * @param {string} entry - An entry produced by formatEntry.
 * @param {string} ecosystem - The ecosystem the entry came from.
 * @returns {string|null} - The key, or null if the entry is empty.
 */
function dedupeKey(entry, ecosystem) {
    const name = baseName(entry);
    return name ? `${ecosystem}:${normalizeName(name, ecosystem)}` : null;
}

/**
 * Splits a PEP 508 requirement into its name and version constraint, discarding
 * extras and environment markers. Extras must go: the Observatory's statistics
 * pass does not strip them, so "uvicorn[standard]" would otherwise be counted as a
 * package of its own.
 *
 * @param {string} requirement - e.g. 'uvicorn[standard]>=0.32.0,<1.0 ; python_version < "3.13"'
 * @returns {{name: string, constraint: string}|null} - The parts, or null if unparseable.
 */
function splitPep508(requirement) {
    const raw = String(requirement);
    const markerIndex = raw.indexOf(';');
    const marker = markerIndex === -1 ? '' : raw.slice(markerIndex + 1);

    // `extra == "dev"` marks a dependency that only installs alongside an optional
    // extra, which is how pip-compile spells an optional dependency inline. A
    // platform marker such as `python_version < "3.11"` is not optionality, so it
    // gets stripped and the dependency is kept.
    if (/\bextra\s*==/.test(marker)) {
        return null;
    }

    let spec = markerIndex === -1 ? raw : raw.slice(0, markerIndex);
    spec = spec.replace(/\s--hash=\S+/g, '').replace(/\\\s*$/, '').trim();

    if (!spec) {
        return null;
    }

    // A VCS or direct URL requirement only names a package via its #egg= fragment.
    if (spec.includes('://')) {
        const egg = /[#&]egg=([A-Za-z0-9._-]+)/.exec(spec);
        return egg ? { name: egg[1], constraint: '' } : null;
    }

    const match = /^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(.*)$/.exec(spec);
    if (!match) {
        return null;
    }

    let constraint = match[2].trim();

    // Some manifests already parenthesise the constraint: "requests (>=2.0)".
    if (constraint.startsWith('(') && constraint.endsWith(')')) {
        constraint = constraint.slice(1, -1).trim();
    }

    // A PEP 508 direct reference ("pkg @ https://...") carries no usable constraint.
    if (constraint.startsWith('@')) {
        constraint = '';
    }

    return { name: match[1], constraint: constraint };
}

/**
 * Parses a requirements.txt or a rye-style requirements.lock.
 *
 * @param {string} text - The file contents.
 * @returns {string[]} - The runtime dependencies.
 */
function parseRequirementsTxt(text) {
    const entries = [];

    for (const rawLine of String(text == null ? '' : text).split(/\r?\n/)) {
        // Strip inline comments before anything else so "flask  # web" parses.
        let line = rawLine.split(/\s+#/)[0].trim();

        if (!line || line.startsWith('#')) {
            continue;
        }

        // Skip pip options: -r, -c, -e, --index-url, --extra-index-url, ...
        if (line.startsWith('-')) {
            continue;
        }

        const parsed = splitPep508(line);
        if (parsed) {
            entries.push(formatEntry(parsed.name, parsed.constraint));
        }
    }

    return entries.filter(Boolean);
}

/**
 * Parses a pyproject.toml, covering both the PEP 621 [project] table and Poetry's
 * [tool.poetry.dependencies]. Optional, dev and grouped dependencies are skipped.
 *
 * @param {string} text - The file contents.
 * @returns {string[]} - The runtime dependencies, including the Python requirement.
 */
function parsePyprojectToml(text) {
    try {
        const doc = TOML.parse(String(text == null ? '' : text));
        const entries = [];
        const project = doc.project || {};

        if (project['requires-python']) {
            entries.push(formatEntry('Python', project['requires-python']));
        }

        for (const requirement of project.dependencies || []) {
            const parsed = splitPep508(requirement);
            if (parsed) {
                entries.push(formatEntry(parsed.name, parsed.constraint));
            }
        }

        // Poetry declares dependencies as a table rather than a PEP 508 list.
        const poetry = (doc.tool && doc.tool.poetry && doc.tool.poetry.dependencies) || {};
        for (const [name, value] of Object.entries(poetry)) {
            const isTable = value && typeof value === 'object' && !Array.isArray(value);

            if (isTable && value.optional) {
                continue;
            }

            const constraint = isTable ? value.version || '' : String(value);

            if (name.toLowerCase() === 'python') {
                entries.push(formatEntry('Python', constraint));
            } else {
                entries.push(formatEntry(name, constraint));
            }
        }

        return entries.filter(Boolean);
    } catch (parseError) {
        console.error('Error parsing pyproject.toml:', parseError.message);
        return [];
    }
}

/**
 * Parses the [options] section of a setup.cfg.
 *
 * @param {string} text - The file contents.
 * @returns {string[]} - The runtime dependencies, including the Python requirement.
 */
function parseSetupCfg(text) {
    const entries = [];
    let section = null;
    let key = null;
    let buffer = [];

    const flush = () => {
        if (key === 'install_requires') {
            for (const requirement of buffer) {
                const parsed = splitPep508(requirement);
                if (parsed) {
                    entries.push(formatEntry(parsed.name, parsed.constraint));
                }
            }
        } else if (key === 'python_requires' && buffer.length) {
            entries.push(formatEntry('Python', buffer.join(' ')));
        }
        key = null;
        buffer = [];
    };

    for (const rawLine of String(text == null ? '' : text).split(/\r?\n/)) {
        const sectionHeader = /^\[([^\]]+)\]\s*$/.exec(rawLine);
        if (sectionHeader) {
            flush();
            section = sectionHeader[1].toLowerCase();
            continue;
        }

        // Keys are flush-left; continuation values are indented.
        const keyValue = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(rawLine);
        if (keyValue) {
            flush();
            if (section !== 'options') {
                continue;
            }
            key = keyValue[1].toLowerCase();
            if (keyValue[2].trim()) {
                buffer.push(keyValue[2].trim());
            }
            continue;
        }

        if (key && /^\s+\S/.test(rawLine)) {
            buffer.push(rawLine.trim());
        }
    }

    flush();
    return entries.filter(Boolean);
}

/**
 * Parses the [packages] table of a Pipfile.
 *
 * @param {string} text - The file contents.
 * @returns {string[]} - The runtime dependencies.
 */
function parsePipfile(text) {
    try {
        const doc = TOML.parse(String(text == null ? '' : text));
        const entries = [];

        for (const [name, value] of Object.entries(doc.packages || {})) {
            const isTable = value && typeof value === 'object' && !Array.isArray(value);
            const constraint = isTable ? value.version || '' : String(value);
            entries.push(formatEntry(name, constraint));
        }

        return entries.filter(Boolean);
    } catch (parseError) {
        console.error('Error parsing Pipfile:', parseError.message);
        return [];
    }
}

/**
 * Parses a conda environment.yml, including any nested pip section.
 *
 * @param {string} text - The file contents.
 * @returns {string[]} - The runtime dependencies.
 */
function parseEnvironmentYml(text) {
    try {
        const doc = yaml.load(String(text == null ? '' : text));
        const entries = [];

        for (const item of (doc && doc.dependencies) || []) {
            if (typeof item === 'string') {
                // conda specs look like "numpy=1.2", "numpy >=1.2" or just "numpy".
                const match = /^([A-Za-z0-9._-]+)\s*(.*)$/.exec(item.trim());
                if (!match) {
                    continue;
                }
                const name = match[1].toLowerCase() === 'python' ? 'Python' : match[1];
                entries.push(formatEntry(name, match[2]));
            } else if (item && Array.isArray(item.pip)) {
                for (const requirement of item.pip) {
                    const parsed = splitPep508(requirement);
                    if (parsed) {
                        entries.push(formatEntry(parsed.name, parsed.constraint));
                    }
                }
            }
        }

        return entries.filter(Boolean);
    } catch (parseError) {
        console.error('Error parsing environment.yml:', parseError.message);
        return [];
    }
}

/**
 * Parses a package.json, taking only `dependencies` and the Node engine constraint.
 *
 * @param {string} text - The file contents.
 * @returns {string[]} - The runtime dependencies.
 */
function parsePackageJson(text) {
    try {
        const doc = JSON.parse(String(text == null ? '' : text));
        const entries = [];

        if (doc.engines && doc.engines.node) {
            entries.push(formatEntry('Node.js', doc.engines.node));
        }

        for (const [name, range] of Object.entries(doc.dependencies || {})) {
            entries.push(formatEntry(name, range));
        }

        return entries.filter(Boolean);
    } catch (parseError) {
        console.error('Error parsing package.json:', parseError.message);
        return [];
    }
}

/**
 * Parses a package-lock.json, handling both the v1 layout and the v2/v3 `packages`
 * layout. Entries flagged as dev or optional are skipped.
 *
 * @param {string} text - The file contents.
 * @returns {string[]} - The locked runtime dependencies.
 */
function parsePackageLockJson(text) {
    try {
        const doc = JSON.parse(String(text == null ? '' : text));
        const entries = [];

        if (doc.packages && typeof doc.packages === 'object') {
            for (const [path, meta] of Object.entries(doc.packages)) {
                // The empty key is the project itself, not a dependency.
                if (!path || !meta || meta.dev || meta.devOptional || meta.optional) {
                    continue;
                }
                const name = path.replace(/^.*node_modules\//, '');
                if (name) {
                    entries.push(formatEntry(name, meta.version ? `==${meta.version}` : ''));
                }
            }
        } else {
            for (const [name, meta] of Object.entries(doc.dependencies || {})) {
                if (!meta || meta.dev) {
                    continue;
                }
                entries.push(formatEntry(name, meta.version ? `==${meta.version}` : ''));
            }
        }

        return entries.filter(Boolean);
    } catch (parseError) {
        console.error('Error parsing package-lock.json:', parseError.message);
        return [];
    }
}

/**
 * Parses an R DESCRIPTION file. Only the fields that describe what is needed to run
 * the package are read; Suggests and Enhances are ignored.
 *
 * @param {string} text - The file contents.
 * @returns {string[]} - The runtime dependencies, including the R requirement.
 */
function parseDescription(text) {
    const runtimeFields = ['depends', 'imports', 'linkingto'];
    const fields = {};
    let current = null;

    // DESCRIPTION is DCF: "Field: value", with continuation lines indented.
    for (const rawLine of String(text == null ? '' : text).split(/\r?\n/)) {
        const header = /^([A-Za-z][A-Za-z0-9-]*):\s?(.*)$/.exec(rawLine);
        if (header) {
            current = header[1].toLowerCase();
            fields[current] = header[2];
        } else if (current && /^\s+\S/.test(rawLine)) {
            fields[current] += ' ' + rawLine.trim();
        }
    }

    const entries = [];
    for (const field of runtimeFields) {
        if (!fields[field]) {
            continue;
        }
        for (const rawSpec of fields[field].split(',')) {
            const spec = rawSpec.trim();
            if (!spec) {
                continue;
            }
            const match = /^([A-Za-z0-9._]+)\s*(?:\(([^)]*)\))?/.exec(spec);
            if (match) {
                entries.push(formatEntry(match[1], (match[2] || '').trim()));
            }
        }
    }

    return entries.filter(Boolean);
}

/**
 * Parses a Cargo.toml. Dev, build and optional dependencies are skipped.
 *
 * @param {string} text - The file contents.
 * @returns {string[]} - The runtime dependencies, including the Rust requirement.
 */
function parseCargoToml(text) {
    try {
        const doc = TOML.parse(String(text == null ? '' : text));
        const entries = [];
        const pkg = doc.package || {};

        if (pkg['rust-version']) {
            entries.push(formatEntry('Rust', `>=${pkg['rust-version']}`));
        }

        for (const [name, value] of Object.entries(doc.dependencies || {})) {
            const isTable = value && typeof value === 'object' && !Array.isArray(value);
            if (isTable && value.optional) {
                continue;
            }
            entries.push(formatEntry(name, isTable ? value.version || '' : String(value)));
        }

        return entries.filter(Boolean);
    } catch (parseError) {
        console.error('Error parsing Cargo.toml:', parseError.message);
        return [];
    }
}

/**
 * Parses the [[package]] entries of a Cargo.lock.
 *
 * @param {string} text - The file contents.
 * @returns {string[]} - The locked crates.
 */
function parseCargoLock(text) {
    try {
        const doc = TOML.parse(String(text == null ? '' : text));
        const packages = Array.isArray(doc.package) ? doc.package : [];

        return packages
            .map((pkg) => formatEntry(pkg.name, pkg.version ? `==${pkg.version}` : ''))
            .filter(Boolean);
    } catch (parseError) {
        console.error('Error parsing Cargo.lock:', parseError.message);
        return [];
    }
}

/**
 * Parses a go.mod. Modules marked `// indirect` are kept, since lock contents are
 * merged in anyway.
 *
 * @param {string} text - The file contents.
 * @returns {string[]} - The required modules, including the Go requirement.
 */
function parseGoMod(text) {
    const entries = [];
    let inRequireBlock = false;

    for (const rawLine of String(text == null ? '' : text).split(/\r?\n/)) {
        const line = rawLine.replace(/\/\/.*$/, '').trim();

        if (!line) {
            continue;
        }

        const goVersion = /^go\s+(\d+\.\d+(?:\.\d+)?)$/.exec(line);
        if (goVersion) {
            // The go directive states a minimum, so render it as one.
            entries.push(formatEntry('Go', `>=${goVersion[1]}`));
            continue;
        }

        if (/^require\s*\($/.test(line)) {
            inRequireBlock = true;
            continue;
        }

        if (inRequireBlock && line === ')') {
            inRequireBlock = false;
            continue;
        }

        const singleLine = /^require\s+(\S+)\s+(\S+)$/.exec(line);
        if (singleLine) {
            entries.push(formatEntry(singleLine[1], `==${singleLine[2]}`));
            continue;
        }

        if (inRequireBlock) {
            const module = /^(\S+)\s+(\S+)$/.exec(line);
            if (module) {
                entries.push(formatEntry(module[1], `==${module[2]}`));
            }
        }
    }

    return entries.filter(Boolean);
}

/*
The files looked for at the repository root. `kind` drives precedence: manifests are
merged before locks, so an author's declared constraint wins over an exact pin.
*/
const MANIFESTS = [
    { path: 'pyproject.toml', ecosystem: 'python', kind: 'manifest', parse: parsePyprojectToml },
    { path: 'setup.cfg', ecosystem: 'python', kind: 'manifest', parse: parseSetupCfg },
    { path: 'requirements.txt', ecosystem: 'python', kind: 'manifest', parse: parseRequirementsTxt },
    { path: 'Pipfile', ecosystem: 'python', kind: 'manifest', parse: parsePipfile },
    { path: 'environment.yml', ecosystem: 'python', kind: 'manifest', parse: parseEnvironmentYml },
    { path: 'environment.yaml', ecosystem: 'python', kind: 'manifest', parse: parseEnvironmentYml },
    { path: 'requirements.lock', ecosystem: 'python', kind: 'lock', parse: parseRequirementsTxt },
    { path: 'package.json', ecosystem: 'javascript', kind: 'manifest', parse: parsePackageJson },
    { path: 'package-lock.json', ecosystem: 'javascript', kind: 'lock', parse: parsePackageLockJson },
    { path: 'DESCRIPTION', ecosystem: 'r', kind: 'manifest', parse: parseDescription },
    { path: 'Cargo.toml', ecosystem: 'rust', kind: 'manifest', parse: parseCargoToml },
    { path: 'Cargo.lock', ecosystem: 'rust', kind: 'lock', parse: parseCargoLock },
    { path: 'go.mod', ecosystem: 'go', kind: 'manifest', parse: parseGoMod },
];

/**
 * Fetches every candidate manifest in a single GraphQL request. Each path gets its
 * own alias; a path that does not exist simply resolves to null instead of failing
 * the query, so one round trip covers the whole table.
 *
 * @param {Octokit} octokit - An authenticated Octokit instance.
 * @param {string} owner - The owner of the repository.
 * @param {string} repo - The name of the repository.
 * @returns {Promise<Array<{manifest: Object, text: string}>>} - The manifests that exist.
 */
async function fetchManifestBlobs(octokit, owner, repo) {
    const aliases = MANIFESTS
        .map((manifest, index) => `f${index}: object(expression: "HEAD:${manifest.path}") { ...ManifestBlob }`)
        .join('\n                ');

    const query = `
        query ($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
                ${aliases}
            }
        }

        fragment ManifestBlob on Blob {
            text
            byteSize
            isTruncated
        }
    `;

    const result = await octokit.graphql(query, { owner: owner, repo: repo });
    const repository = (result && result.repository) || {};

    return MANIFESTS.map((manifest, index) => {
        const blob = repository[`f${index}`];

        // A missing path, a directory, or a binary file all yield no usable text.
        if (!blob || typeof blob.text !== 'string') {
            return null;
        }

        if (blob.isTruncated || blob.byteSize > MAX_BLOB_BYTES) {
            info(`Skipping ${manifest.path}: truncated or over ${MAX_BLOB_BYTES} bytes`);
            return null;
        }

        return { manifest: manifest, text: blob.text };
    }).filter(Boolean);
}

/**
 * Collects the runtime dependencies declared by a repository across all supported
 * ecosystems, deduplicated by package name.
 *
 * Always resolves to an array: PrepareListsIds iterates this field without guarding,
 * so returning undefined would turn any failure here into a 500 for the whole request.
 *
 * @param {Octokit} octokit - An authenticated Octokit instance.
 * @param {string} owner - The owner of the repository.
 * @param {string} repo - The name of the repository.
 * @returns {Promise<string[]>} - The dependencies, runtimes first, then alphabetical.
 */
async function fetchDependencies(octokit, owner, repo) {
    try {
        const blobs = await fetchManifestBlobs(octokit, owner, repo);

        if (blobs.length === 0) {
            info('No dependency manifests found');
            return [];
        }

        // Manifests first so their constraints take precedence over locked pins.
        const ordered = [
            ...blobs.filter((blob) => blob.manifest.kind === 'manifest'),
            ...blobs.filter((blob) => blob.manifest.kind === 'lock'),
        ];

        const collected = new Map();

        for (const { manifest, text } of ordered) {
            let entries;

            try {
                entries = manifest.parse(text) || [];
            } catch (parseError) {
                console.error(`Error parsing ${manifest.path}:`, parseError.message);
                continue;
            }

            info(`Found ${entries.length} dependencies in ${manifest.path}`);

            for (const entry of entries) {
                const key = dedupeKey(entry, manifest.ecosystem);
                if (key && !collected.has(key)) {
                    collected.set(key, entry);
                }
            }
        }

        const runtimes = [];
        const packages = [];

        for (const [key, entry] of collected) {
            const isRuntime = RUNTIME_NAMES.has(baseName(entry).toLowerCase());
            (isRuntime ? runtimes : packages).push([key, entry]);
        }

        // Byte-wise, not localeCompare: the sort has to be reproducible regardless of
        // the locale the server happens to boot with.
        const byKey = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
        runtimes.sort(byKey);
        packages.sort(byKey);

        return [...runtimes, ...packages].map(([, entry]) => entry);
    } catch (fetchError) {
        console.error('Error fetching dependencies:', fetchError);
        return [];
    }
}

module.exports = {
    fetchDependencies,
    fetchManifestBlobs,
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
};
