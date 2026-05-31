# pi-list-extensions

Fork of [masonc15/pi-list-extensions](https://github.com/masonc15/pi-list-extensions) with package discovery and extension management for [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

Adds `/extensions` — an interactive TUI to browse, enable/disable, and open extensions.

The extension library shows all installed extensions from both global (`~/.pi/agent/extensions/`) and project (`.pi/extensions/`) scopes, as well as extensions from installed packages (git, npm, local). Disabled extensions appear greyed out in place.

<img src="screenshot.png" width="600">

## Install

```bash
pi install git:github.com/shrwnsan/pi-list-extensions@dev
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["git:github.com/shrwnsan/pi-list-extensions@dev"]
}
```

## Usage

```
/extensions
```

| Key | Action |
|-----|--------|
| `↑↓` | Navigate |
| `Enter` | Open in editor (`$VISUAL` / `$EDITOR` / `code`) |
| `d` | Toggle enabled/disabled |
| `Esc` | Close |

Toggling an extension writes to `settings.json` using Pi's [standard exclusion format](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md#package-filtering). You'll be prompted to apply immediately, or defer to `/reload`.

## Changes from upstream

**Extension management**

- Toggle enable/disable via `d` key
- Self-protection: cannot disable the extension manager itself (🔒)
- Reload prompt on exit — only shown when net state actually changed

**Package discovery**

- Resolves extensions from git, npm, and local packages in `settings.json`, not just `~/.pi/agent/extensions/` and `.pi/extensions/`
- Shows source type (git/npm/local/package/script) and scope (global/project) per extension

**Fixes**

- Strip `@ref` suffix from git package URLs so path resolution works (`git:github.com/user/repo@main` → `~/.pi/agent/git/github.com/user/repo`)
- Resilient scanning — dangling symlinks and unreadable entries are skipped without hiding other extensions
- Stable list ordering (global first, then project; alphabetical within each group) — toggled items grey out in place instead of jumping

**Removed**

- Print mode (`-v` flag) — the TUI is the only interface
