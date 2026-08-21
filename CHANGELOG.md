# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
