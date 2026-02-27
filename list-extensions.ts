import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import { readdirSync, mkdirSync, realpathSync, statSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename, dirname, relative } from "node:path";
import { homedir } from "node:os";

// Resolve own path for self-protection (prevent disabling the extension manager)
let selfPath: string | null = null;
try {
  selfPath = realpathSync(new URL(import.meta.url).pathname);
} catch {}

function isSelf(extPath: string): boolean {
  if (!selfPath) return false;
  try {
    const resolved = realpathSync(extPath);
    return resolved === selfPath || resolved === dirname(selfPath);
  } catch {
    return false;
  }
}

interface ExtensionInfo {
  name: string;
  path: string;
  scope: "global" | "project";
  type: "file" | "directory";
  disabled: boolean;
}

interface SettingsJson {
  extensions?: string[];
  [key: string]: unknown;
}

function getSettingsPath(scope: "global" | "project", cwd: string): string {
  return scope === "global"
    ? join(homedir(), ".pi", "agent", "settings.json")
    : join(cwd, ".pi", "settings.json");
}

function getAgentDir(scope: "global" | "project", cwd: string): string {
  return scope === "global"
    ? join(homedir(), ".pi", "agent")
    : join(cwd, ".pi");
}

function readSettings(path: string): SettingsJson {
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch {
    // ignore parse errors
  }
  return {};
}

function writeSettings(path: string, settings: SettingsJson): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

// Get the relative pattern for an extension (relative to agentDir)
function getResourcePattern(extPath: string, agentDir: string): string {
  return relative(agentDir, extPath);
}

function isPathExcluded(settings: SettingsJson, extPath: string, agentDir: string): boolean {
  const extensions = Array.isArray(settings.extensions) ? settings.extensions : [];
  const pattern = getResourcePattern(extPath, agentDir);

  // Check for explicit disable pattern
  for (const entry of extensions) {
    const stripped = entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-") ? entry.slice(1) : entry;
    if (stripped === pattern) {
      return entry.startsWith("-");
    }
  }
  return false;
}

function toggleExclusion(settings: SettingsJson, extPath: string, agentDir: string, disable: boolean): SettingsJson {
  const extensions = Array.isArray(settings.extensions) ? settings.extensions : [];
  const pattern = getResourcePattern(extPath, agentDir);
  const disablePattern = `-${pattern}`;
  const enablePattern = `+${pattern}`;

  // Filter out existing patterns for this resource
  const updated = extensions.filter((p) => {
    const stripped = p.startsWith("!") || p.startsWith("+") || p.startsWith("-") ? p.slice(1) : p;
    return stripped !== pattern;
  });

  if (disable) {
    updated.push(disablePattern);
  } else {
    updated.push(enablePattern);
  }

  return { ...settings, extensions: updated };
}

function discoverExtensions(cwd: string): ExtensionInfo[] {
  const extensions: ExtensionInfo[] = [];

  const locations = [
    { dir: join(homedir(), ".pi", "agent", "extensions"), scope: "global" as const },
    { dir: join(cwd, ".pi", "extensions"), scope: "project" as const },
  ];

  // Read settings for both scopes
  const globalSettings = readSettings(getSettingsPath("global", cwd));
  const projectSettings = readSettings(getSettingsPath("project", cwd));

  for (const { dir, scope } of locations) {
    if (!existsSync(dir)) continue;

    const settings = scope === "global" ? globalSettings : projectSettings;
    const agentDir = getAgentDir(scope, cwd);

    try {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        // Skip hidden files and .DS_Store
        if (entry.startsWith(".")) continue;

        const fullPath = join(dir, entry);
        let stat;
        try {
          stat = statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.isFile() && (entry.endsWith(".ts") || entry.endsWith(".js"))) {
          // Direct file extension
          extensions.push({
            name: basename(entry, entry.endsWith(".ts") ? ".ts" : ".js"),
            path: fullPath,
            scope,
            type: "file",
            disabled: isPathExcluded(settings, fullPath, agentDir),
          });
        } else if (stat.isDirectory()) {
          // Check for index.ts or package.json with pi field
          const indexPath = join(fullPath, "index.ts");
          const indexJsPath = join(fullPath, "index.js");
          const packagePath = join(fullPath, "package.json");

          if (existsSync(indexPath) || existsSync(indexJsPath) || existsSync(packagePath)) {
            extensions.push({
              name: entry,
              path: fullPath,
              scope,
              type: "directory",
              disabled: isPathExcluded(settings, fullPath, agentDir),
            });
          }
        }
      }
    } catch (e) {
      // Skip directories we can't read
    }
  }

  // Sort: global first, then project; alphabetical within each group
  extensions.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "global" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return extensions;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("extensions", {
    description: "List all installed pi extensions",
    handler: async (args, ctx) => {
      let extensions = discoverExtensions(ctx.cwd);

      if (extensions.length === 0) {
        if (ctx.hasUI) {
          ctx.ui.notify("No extensions found", "info");
        } else {
          console.log("No extensions found");
        }
        return;
      }

      // Group by scope
      const global = extensions.filter((e) => e.scope === "global");
      const project = extensions.filter((e) => e.scope === "project");
      const verbose = args === "-v" || args === "--verbose";

      const lines: string[] = [];
      lines.push(`Found ${extensions.length} extension(s):`);
      lines.push("");

      if (global.length > 0) {
        lines.push(`Global (~/.pi/agent/extensions/):`);
        for (const ext of global) {
          const icon = ext.type === "directory" ? "📁" : "📄";
          const status = ext.disabled ? " (disabled)" : "";
          if (verbose) {
            lines.push(`  ${icon} ${ext.name}${status}`);
            lines.push(`     ${ext.path}`);
          } else {
            lines.push(`  ${icon} ${ext.name}${status}`);
          }
        }
      }

      if (project.length > 0) {
        if (global.length > 0) lines.push("");
        lines.push(`Project (.pi/extensions/):`);
        for (const ext of project) {
          const icon = ext.type === "directory" ? "📁" : "📄";
          const status = ext.disabled ? " (disabled)" : "";
          if (verbose) {
            lines.push(`  ${icon} ${ext.name}${status}`);
            lines.push(`     ${ext.path}`);
          } else {
            lines.push(`  ${icon} ${ext.name}${status}`);
          }
        }
      }

      if (ctx.hasUI) {
        const extByPath = new Map(extensions.map((ext) => [ext.path, ext]));
        const initialState = new Map(extensions.map((ext) => [ext.path, ext.disabled]));
        const MAX_VISIBLE_ITEMS = 20;
        
        const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
          const buildSelectItems = (): SelectItem[] => {
            return extensions.map((ext) => {
              const isDir = ext.type === "directory";
              const iconSymbol = isDir ? "📦" : "⚡";

              let icon: string;
              let nameDisplay: string;
              let description: string;

              const scopeLabel = ext.scope === "project" ? "Project" : "Global";
              const typeLabel = isDir ? "Package" : "Script";

              if (ext.disabled) {
                icon = theme.fg("dim", iconSymbol);
                nameDisplay = theme.fg("dim", ext.name);
                description = `${theme.fg("dim", scopeLabel)} ${theme.fg("dim", "•")} ${theme.fg("dim", typeLabel)} ${theme.fg("dim", "• disabled")}`;
              } else {
                icon = isDir ? theme.fg("warning", iconSymbol) : theme.fg("accent", iconSymbol);
                nameDisplay = ext.name;
                description = `${scopeLabel} ${theme.fg("dim", "•")} ${typeLabel}`;
              }

              if (isSelf(ext.path)) {
                description += ` ${theme.fg("dim", "• 🔒")}`;
              }

              return {
                value: ext.path,
                label: `${icon}  ${nameDisplay}`,
                description,
              };
            });
          };

          const selectListTheme = {
            selectedPrefix: (t: string) => theme.fg("accent", t),
            selectedText: (t: string) => theme.fg("accent", t),
            description: (t: string) => theme.fg("muted", t),
            scrollInfo: (t: string) => theme.fg("dim", t),
            noMatch: (t: string) => theme.fg("warning", t),
          };

          const container = new Container();

          const globalCount = extensions.filter((e) => e.scope === "global").length;
          const projectCount = extensions.filter((e) => e.scope === "project").length;

          const title = new Text(theme.fg("accent", theme.bold("Extensions Library")), 1, 0);

          const getSubtitleText = () => {
            const en = extensions.filter((e) => !e.disabled).length;
            const dis = extensions.filter((e) => e.disabled).length;
            let text = `${en} enabled`;
            if (dis > 0) text += ` • ${theme.fg("dim", `${dis} disabled`)}`;
            text += ` • ${globalCount} global • ${projectCount} project`;
            return theme.fg("dim", text);
          };

          const subtitle = new Text(getSubtitleText(), 1, 0);
          const detailText = new Text("", 1, 0);
          const helpText = new Text(
            theme.fg("dim", "↑↓ navigate • enter open • d enable/disable • esc close"), 1, 0,
          );

          const updateDetails = (item: SelectItem | null) => {
            if (!item) {
              detailText.setText("");
              return;
            }

            const ext = extByPath.get(item.value);
            if (!ext) {
              detailText.setText(theme.fg("warning", "No extension details available"));
              return;
            }

            const isDir = ext.type === "directory";
            const iconSymbol = isDir ? "📦" : "⚡";
            const icon = ext.disabled
              ? theme.fg("dim", iconSymbol)
              : isDir
                ? theme.fg("warning", iconSymbol)
                : theme.fg("accent", iconSymbol);
            const typeLabel = isDir ? "Package" : "Script";
            const scopeLabel = ext.scope === "project" ? "Project" : "Global";
            const statusLabel = ext.disabled ? theme.fg("dim", " (disabled)") : "";

            const lines = [
              "",
              `${theme.fg("accent", "Selected:")} ${icon} ${theme.bold(ext.name)}${statusLabel} ${theme.fg("dim", "•")} ${typeLabel} ${theme.fg("dim", "•")} ${scopeLabel}`,
              `${theme.fg("muted", "Path:")} ${theme.fg("dim", ext.path)}`,
            ];

            detailText.setText(lines.join("\n"));
          };

          let selectList: SelectList;

          const wireSelectList = () => {
            selectList.onSelect = (item) => done(item.value);
            selectList.onCancel = () => done(null);
            selectList.onSelectionChange = (item) => {
              updateDetails(item);
              tui.requestRender();
            };
          };

          const rebuildContainer = () => {
            container.children = [];
            container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
            container.addChild(title);
            subtitle.setText(getSubtitleText());
            container.addChild(subtitle);
            container.addChild(selectList);
            container.addChild(detailText);
            container.addChild(helpText);
            container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
          };

          // Initial build
          selectList = new SelectList(buildSelectItems(), Math.min(extensions.length, MAX_VISIBLE_ITEMS), selectListTheme);
          wireSelectList();
          rebuildContainer();
          updateDetails(selectList.getSelectedItem());

          return {
            render: (w) => container.render(w),
            invalidate: () => container.invalidate(),
            handleInput: (data) => {
              // Handle 'd' key for toggle
              if (data === "d" || data === "D") {
                const selected = selectList.getSelectedItem();
                if (selected) {
                  const ext = extByPath.get(selected.value);
                  if (ext && !isSelf(ext.path)) {
                    const settingsPath = getSettingsPath(ext.scope, ctx.cwd);
                    const agentDir = getAgentDir(ext.scope, ctx.cwd);
                    let settings = readSettings(settingsPath);

                    const nowDisabled = !ext.disabled;
                    settings = toggleExclusion(settings, ext.path, agentDir, nowDisabled);
                    writeSettings(settingsPath, settings);
                    ext.disabled = nowDisabled;

                    selectList = new SelectList(buildSelectItems(), Math.min(extensions.length, MAX_VISIBLE_ITEMS), selectListTheme);
                    const currentIndex = extensions.findIndex((e) => e.path === ext.path);
                    if (currentIndex >= 0) selectList.setSelectedIndex(currentIndex);
                    wireSelectList();
                    rebuildContainer();
                    updateDetails(selectList.getSelectedItem());
                    tui.requestRender();
                  }
                }
                return;
              }

              selectList.handleInput(data);
              tui.requestRender();
            },
          };
        });

        // Prompt to reload if state actually changed
        const hasChanges = extensions.some((e) => e.disabled !== initialState.get(e.path));
        if (hasChanges) {
          const reloadChoice = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
            const container = new Container();
            container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
            container.addChild(new Text(
              theme.fg("warning", "⚠ ") + theme.bold("Extensions changed") + theme.fg("dim", " — reload to apply?"),
              1, 0,
            ));
            container.addChild(new Text(
              theme.fg("dim", "This will reload extensions, skills, prompts, and themes."),
              1, 0,
            ));

            const items: SelectItem[] = [
              { value: "now", label: theme.fg("accent", "Apply now"), description: "" },
              { value: "later", label: "Later", description: "" },
            ];

            const list = new SelectList(items, 2, {
              selectedPrefix: (t: string) => theme.fg("accent", t),
              selectedText: (t: string) => theme.fg("accent", t),
              description: (t: string) => theme.fg("muted", t),
              scrollInfo: (t: string) => theme.fg("dim", t),
              noMatch: (t: string) => theme.fg("warning", t),
            });

            list.onSelect = (item) => done(item.value);
            list.onCancel = () => done(null);

            container.addChild(new Text("", 0, 0));
            container.addChild(list);
            container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

            return {
              render: (w) => container.render(w),
              invalidate: () => container.invalidate(),
              handleInput: (data) => {
                list.handleInput(data);
                tui.requestRender();
              },
            };
          });

          if (reloadChoice === "now") {
            await ctx.reload();
            ctx.ui.notify("Extensions reloaded", "info");
          } else {
            ctx.ui.notify("Run /reload when ready to apply changes", "info");
          }
        }

        if (result !== null && result !== undefined) {
          const ext = extByPath.get(result);
          if (!ext) {
            ctx.ui.notify("Invalid selection", "error");
            return;
          }

          let filePath = ext.path;
          if (ext.type === "directory") {
            const indexTs = join(ext.path, "index.ts");
            const indexJs = join(ext.path, "index.js");
            const packageJson = join(ext.path, "package.json");

            if (existsSync(indexTs)) filePath = indexTs;
            else if (existsSync(indexJs)) filePath = indexJs;
            else if (existsSync(packageJson)) filePath = packageJson;
          }

          // Use $VISUAL, $EDITOR, or fall back to 'code'
          const editor = process.env.VISUAL || process.env.EDITOR || "code";
          const resultExec = await pi.exec(editor, [filePath]);

          if (resultExec.code === 0) {
            ctx.ui.notify(`Opened ${ext.name} in ${editor}`, "info");
          } else {
            ctx.ui.notify(`Failed to open: ${resultExec.stderr || "unknown error"}`, "error");
          }
        }
      } else {
        // Print mode: output to console
        console.log(lines.join("\n"));
      }
    },
  });
}
