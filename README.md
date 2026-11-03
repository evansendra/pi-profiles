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
| `/profiles SOURCE TARGET` | Copy source settings into an existing target profile. |

New profiles automatically load this extension. Launch one and use `/login` to authenticate. Selecting a profile does not switch the running session.

Names may contain letters, numbers, underscores, and hyphens, starting with a letter or number. `main`, `current`, and command names are reserved.

## Settings sync

Sync replaces the target's `settings.json`, preserving its `deviceId` and `sessionDir`. All other settings follow the source, including removing target-only keys. Nested objects are replaced, not merged. Credentials, sessions, and resource files such as themes or extensions are not copied.

Settings can contain secrets or paths specific to a profile. Preview first, and close the target's Pi sessions before syncing; a running instance can overwrite external changes. Restart the target to load its new settings.

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
pi install /path/to/pi-profiles
npm test
```

Run `/reload` after edits. Avoid loading both a development copy and an npm installation in the same profile. Newly created profiles link to this package's directory, so keep it available.

## License

MIT.
