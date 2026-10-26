# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.2] - 2026-10-26

### Security

- Upgraded the Node.js runtime from 18 (end of life) to 24.22.1 to address CVE-2026-111497. The Docker image is now built from `node:24.22.1-alpine`, CI tests run on the same version, and `package.json` declares `engines.node >= 24.22.1`. A `.nvmrc` pins the version for local development.

### Fixed

- `POST /metadata/content` returned 500 for every request: it passed an undefined `ref` to GitHub. It now reads the file from the repository's default branch, like `POST /metadata/content/user`.
- `POST /metadata` never responded when a GitHub call failed, leaving the client to time out. It now returns the error status with `{data: null, message}`.
- `GET /metadata-extractor-for-fairsoft/installation/id` and `GET /metadata-updater-for-fairsoft/installation/id` reported a repository without the app installed as a success with `data: null`. They now respond 404, with the status in the body as well.
- `POST /metadata/pull` sent failures with HTTP 200. It now uses the error status (404 for a missing target branch, 500 otherwise), and `code` in the body is always set.

### Added

- Route tests for every endpoint (`npm test`), against an in-memory GitHub, so they need no network or credentials.

## [1.2.1] - 2026-09-09

### Fixed

- Documentation URLs returned by `POST /metadata` and `POST /metadata/user` are now built against `HEAD` instead of the hardcoded branch `main`, so they resolve to the repository's actual default branch. Repositories that default to `master` or any other name previously received documentation links that all returned 404.

### Changed

- Documentation files that match no known filename are now typed `unclassified` instead of being labelled with the directory they were found in (`root`, `docs`, `example`). A directory name is not a documentation category.

## [1.2.0] - 2026-08-21

### Added

- Dependency extraction for `POST /metadata` and `POST /metadata/user`: the `dependencies` field is now populated from the package manifests and lock files at the repository root, instead of always returning an empty list.
- Support for Python, JavaScript/TypeScript, R, Rust and Go manifests, merged with their lock files and deduplicated. Language runtime requirements (`requires-python`, `engines.node`, the `go` directive, `rust-version`) are included as entries.
- Optional `dependencies_extract` request body flag (default `true`) to skip the extra lookup.
- Unit test suite (`npm test`), and a `test` job in CI that runs on every push and pull request.

### Changed

- `package.json` is now the single source of truth for the version, read by the OpenAPI spec and by CI.
- Releases are triggered by pushing a `v*` tag or publishing a GitHub Release. CI no longer creates tags on merges to `main`, and the build fails if the tag does not match the version in `package.json`.

### Removed

- The `VERSION` file, superseded by `package.json`.

## [1.0.3] - 2024-10-29

### Fixed

- The API docs read the version from the version file.

## [1.0.2] - 2024-10-24

### Fixed

- The pull request endpoint is compatible with the previous version.

## [1.0.1] - 2024-10-24

### Fixed

- Corrected the container registry in the release workflow.

## [1.0.0] - 2024-10-24

### Added

- Initial release: metadata extraction and metadata update endpoints, backed by the Metadata Extractor and Metadata Updater GitHub Apps, with Swagger docs and a release workflow.
