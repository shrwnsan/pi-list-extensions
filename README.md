# pi-list-extensions

A pi extension that adds the `/extensions` command to list and open installed pi extensions.

## Features

- **Extensions Library UI** with install counts (global vs project)
- **Live details panel** showing name, scope, type, path, and open target
- **Opens in editor** on Enter (`$VISUAL` / `$EDITOR` / `code`)
- **Supports both scopes:**
  - Global: `~/.pi/agent/extensions/`
  - Project: `.pi/extensions/`
- **Non-interactive mode** prints formatted list to stdout

## Installation

Symlink to your pi extensions directory:

```bash
ln -s /path/to/pi-list-extensions/list-extensions.ts ~/.pi/agent/extensions/
```

## Usage

```
/extensions      # Open interactive picker
/extensions -v   # Verbose mode with full paths
```

### Controls

| Key | Action |
|-----|--------|
| ↑↓ | Navigate |
| Enter | Open in editor |
| Esc | Close |
