# pi-list-extensions

`/extensions` command for pi. Lists installed extensions, opens in editor.

## Install

```bash
ln -s /path/to/list-extensions.ts ~/.pi/agent/extensions/
```

## Usage

```
/extensions         # interactive picker (details panel shows paths)
```

Print mode (non-interactive):
```bash
echo "/extensions" | pi --no-session      # compact list
echo "/extensions -v" | pi --no-session   # with full paths
```

`↑↓` navigate · `Enter` open · `Esc` close
