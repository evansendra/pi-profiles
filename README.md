# Pi profiles

Manage isolated [Pi](https://pi.dev) config profiles and sync their settings.

## Install

```sh
pi install npm:@evansendra/pi-profiles
```

Run `/reload` in an existing Pi session after installation.

## Commands

| Command | Action |
| --- | --- |
| `/profiles` or `/profiles list` | List profiles, directories, and launch commands. The current profile appears first, marked `*`. |
| `/profiles NAME` | Show the command to launch that profile in another shell. |
| `/profiles new NAME` | Create a fresh profile at `~/.pi/profiles/NAME`, or show its location if it already exists. |
| `/profiles remove NAME` | Permanently delete a profile after confirmation, including credentials and session history. |
| `/profiles SOURCE TARGET --dry-run` | Preview settings to copy and remove without changing anything. `--dry-run` can also come first. |
| `/profiles SOURCE TARGET` | Copy settings, keybindings, prompts, skills, and themes into an existing target profile. |
| `/profiles export NAME [--path FILE_OR_DIRECTORY] [--dry-run]` | Preview and export portable preferences and local resources. |
| `/profiles import FILE [NEW_NAME] [--dry-run]` | Preview a bundle and restore into a new profile (default name: `imported`). |

New profiles automatically load this extension. Launch one and use `/login` to authenticate. Selecting a profile does not switch the running session.

Names may contain letters, numbers, underscores, and hyphens, starting with a letter or number. `main`, `current`, and command names are reserved.

## Settings sync

Sync replaces the target's `settings.json`, preserving its `deviceId` and `sessionDir`. All other settings follow the source, including removing target-only keys. Nested objects are replaced, not merged.

Profile-local `prompts/`, `skills/`, and `themes/` are copied recursively. Matching target files are overwritten; target-only files are retained. Local skill support files and scripts are included (unlike the more restrictive export format). Source symlinks, `.git`, and `node_modules` are skipped and reported. Destination symlinks and file/directory conflicts abort the preflight before any writes. Dry-run lists the files to add or replace. Resources are limited to 5000 files, 5000 directories, and 50 MiB.

Profile-local `keybindings.json` is copied by default, replacing the target's entire file rather than merging individual bindings. If the source has no keybindings file, the target's file is retained. Source symlinks are skipped; destination symlinks and wrong file types abort preflight before writes. Dry-run shows whether the file will be added or replaced. This applies to local sync only; portable export/import still excludes keybindings.

References to copied local resources point to the target's copies. Other relative package/resource paths are rebased to preserve their original locations; external files are not copied. Credentials, sessions, MCP configuration, and local extensions are not copied. File replacements are individually atomic, not one transaction: an I/O failure during copying can leave some files updated.

Settings can contain secrets or paths specific to a profile. Preview first, and close the target's Pi sessions before syncing; a running instance can overwrite external changes. Restart the target to load its new settings.

## Move a profile to another computer

```text
/profiles export main --dry-run
/profiles export main
```

The default output is `~/Downloads/main.pi-profile.json` when `~/Downloads` exists as a directory; otherwise it is `main.pi-profile.json` in the working directory. Use `--path ~/Downloads` for an existing directory, or `--path "/path/to/my profile.json"` for a specific filename. The positional filename form (`export main FILE`) also works. Parent directories must already exist. Export shows the destination and a preview and asks for confirmation; existing output files are never overwritten. Review the JSON before transferring it yourself, then on the other computer:

```text
/profiles import /path/to/main.pi-profile.json work --dry-run
/profiles import /path/to/main.pi-profile.json work
```

Import validates the bundle, previews it, and asks for confirmation before creating a fresh profile. It never overwrites an existing profile or runs installation commands. Quote paths containing spaces.

The bundle includes a limited allowlist of model defaults, display/editor preferences, and interaction preferences, plus regular, non-executable profile-local prompt Markdown, theme JSON, and skill Markdown/text/JSON files. Skill scripts, hidden files, and other formats are reported, not copied. Symlinks are never followed; external resource paths are reported. Bundles are limited to 1000 files and 10 MiB.

MCPs are listed by name only—no endpoints, command arguments, environment values, headers, or credentials. Recognized npm and GitHub package sources produce manual reinstall commands; local or unsupported sources require manual setup. Package resource filters also need manual recreation. Review commands before running them.

The new profile contains `RESTORE.txt` with the checklist and launch command. Authenticate on the destination with `/login` and each integration's own setup flow. Keep the installed `pi-profiles` package available; the new profile links to it.

This is not a full backup: authentication, sessions, executable extensions, keybindings, model endpoints, and system instructions are not bundled. Text resources can still contain private information or instructions to run code. There is **no automatic secret detection**—review the included files before sharing, and import only bundles you trust.

## Existing profiles

The extension discovers:

- `main` at `~/.pi/agent`.
- Named directories under `~/.pi/profiles/`.
- Additional mappings in `~/.pi/profiles.json`.
- The active config directory, shown as `current` if otherwise unknown.

To register existing directories, create `~/.pi/profiles.json`:

```json
{
  "profiles": {
    "work": "~/.pi-work"
  }
}
```

Paths must be absolute or start with `~/`. Missing directories are not listed. The registry is optional, shared across profiles, and separate from synced settings. Its location and the named-profile directory are extension conventions, not native Pi features.

## Removal safeguards

`main` and the active profile cannot be removed. Removal also rejects protected directories, directories containing other known profiles, and profiles without a regular `settings.json`. Symlinked profile directories, named-profile roots, and settings files are not supported.

These checks prevent common mistakes; they are not a security sandbox. Register only directories you intend to manage, and close other sessions using a profile before deleting it.

## Development

```sh
npm install
pi install /path/to/pi-profiles
npm test
```

Run `/reload` after edits. Avoid loading both a development copy and an npm installation in the same profile. Newly created profiles link to this package's directory, so keep it available.

## License

MIT.
