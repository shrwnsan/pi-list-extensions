# pi-list-extensions

`/extensions` command for [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent). Browse, enable/disable, and open extensions in your editor.

<img src="screenshot.png" width="600">

## Install

```bash
ln -s /path/to/list-extensions.ts ~/.pi/agent/extensions/
```

## Usage

```
/extensions
```

## Keys

- `↑↓` navigate
- `Enter` open in editor
- `d` enable/disable extension (🔒 locked for the extension manager itself)
- `Esc` close

## Features

- **Scope grouping** — Global extensions listed first, then project-scoped, alphabetical within each group
- **Toggle in place** — Disabled extensions grey out where they are instead of jumping to the bottom
- **Reload prompt** — After toggling, you're prompted to apply changes immediately (`ctx.reload()`) or defer to `/reload` later. Only prompts when the net state actually changed
- **Self-protection** — The extension manager cannot disable itself (shown with 🔒)
- **Resilient scanning** — Dangling symlinks or unreadable entries are skipped without hiding other extensions

Toggling an extension writes to `settings.json` using Pi's [standard exclusion format](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md#package-filtering).
