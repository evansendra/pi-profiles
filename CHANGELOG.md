# Changelog

## [0.2.1]

### Fixed
- Sync profile-local keybindings by default, including Home/End overrides. Replace the complete target file when present in the source; retain target bindings when absent. Dry-run previews changes, source symlinks are skipped, and destination conflicts fail before writes.

### Added
- Manual GitHub Actions publishing with npm provenance and verification against the locally reviewed tarball hash.

### Changed
- Default profile exports to `~/Downloads` when that directory exists, falling back to the working directory. Explicit destinations are unchanged.

## [0.2.0]

### Added
- Export portable preferences and local prompt, skill, and theme text resources to a single profile bundle.
- Import bundles into fresh profiles with previews, confirmation, and a manual package/MCP restoration checklist.
- Choose export destinations with `--path`, including filenames and existing directories.
- Copy local prompts, skills, and themes during profile sync, including skill support files and scripts. Source files replace matching target files; target-only files remain.
- Validate bundle paths, size limits, resource conflicts, and import failure cleanup.

### Fixed
- Rebase relative package and external resource paths when syncing profiles at different directory depths.
- Point references to copied resources at their destination copies.
- Refresh helper modules on `/reload` rather than retaining stale native ESM code.

### Safety
- Export excludes credentials, MCP configuration, sessions, executable extensions, and skill scripts. Prompts and skills may still contain sensitive text; review bundles before transferring them.
- Import never executes restoration commands or installs packages automatically.
- Local sync skips source symlinks and dependency directories; destination conflicts fail preflight before writes.
- Expanded regression coverage from 7 to 20 tests, including same-process extension reloads.
