import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import { readdirSync, realpathSync, statSync, existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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
  source?: string;
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

async function writeSettings(path: string, settings: SettingsJson): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(settings, null, 2) + "\n", "utf-8");
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

type PackageType = "npm" | "git" | "local";

interface ParsedPackageSource {
  type: PackageType;
  source: string;
}

function parsePackageSource(source: string): ParsedPackageSource | null {
  if (source.startsWith("npm:")) {
    return { type: "npm", source };
  }
  if (source.startsWith("git:") || source.startsWith("https://") || source.startsWith("http://") || source.startsWith("ssh://") || source.startsWith("git@")) {
    return { type: "git", source };
  }
  if (source.startsWith("/") || source.startsWith("./") || source.startsWith("../")) {
    return { type: "local", source };
  }
  return null;
}

function resolveGitPackagePath(source: string, scope: "global" | "project", cwd: string): string | null {
  // Strip git: prefix if present
  const url = source.startsWith("git:") ? source.slice(4) : source;

  // Parse host and path from various URL formats
  let host: string;
  let repoPath: string;

  if (url.startsWith("git@")) {
    // git@github.com:user/repo
    const colonIdx = url.indexOf(":");
    if (colonIdx === -1) return null;
    host = url.slice(4, colonIdx);
    repoPath = url.slice(colonIdx + 1).replace(/\.git$/, "");
  } else if (url.startsWith("ssh://")) {
    // ssh://git@github.com/user/repo
    try {
      const u = new URL(url);
      host = u.hostname;
      repoPath = u.pathname.slice(1).replace(/\.git$/, "");
    } catch {
      return null;
    }
  } else if (url.startsWith("https://") || url.startsWith("http://")) {
    try {
      const u = new URL(url);
      host = u.hostname;
      repoPath = u.pathname.slice(1).replace(/\.git$/, "");
    } catch {
      return null;
    }
  } else {
    // Shorthand: github.com/user/repo
    const slashIdx = url.indexOf("/");
    if (slashIdx === -1) return null;
    host = url.slice(0, slashIdx);
    repoPath = url.slice(slashIdx + 1).replace(/\.git$/, "");
  }

  const baseDir = scope === "global"
    ? join(homedir(), ".pi", "agent", "git")
    : join(cwd, ".pi", "git");

  return join(baseDir, host, repoPath);
}

function resolveNpmPackagePath(name: string, scope: "global" | "project", cwd: string): string {
  const baseDir = scope === "global"
    ? join(homedir(), ".pi", "agent", "npm", "node_modules")
    : join(cwd, ".pi", "npm", "node_modules");
  return join(baseDir, name);
}

function discoverPackageExtensions(cwd: string): ExtensionInfo[] {
  const extensions: ExtensionInfo[] = [];
  const globalSettings = readSettings(getSettingsPath("global", cwd));
  const projectSettings = readSettings(getSettingsPath("project", cwd));

  const scopeEntries: Array<{ settings: SettingsJson; scope: "global" | "project" }> = [
    { settings: projectSettings, scope: "project" },
    { settings: globalSettings, scope: "global" },
  ];

  for (const { settings, scope } of scopeEntries) {
    const packages = settings.packages;
    if (!Array.isArray(packages)) continue;

    for (const pkg of packages) {
      const sourceStr = typeof pkg === "string" ? pkg : pkg.source;
      if (!sourceStr) continue;

      // Skip filtered packages
      const filter = typeof pkg === "object" ? pkg : undefined;
      if (filter?.extensions?.length === 0) continue;

      const parsed = parsePackageSource(sourceStr);
      if (!parsed) continue;

      let installedPath: string | null = null;
      if (parsed.type === "git") {
        installedPath = resolveGitPackagePath(parsed.source, scope, cwd);
      } else if (parsed.type === "npm") {
        // Extract package name from spec (e.g., "pi-answer@1.0.0" → "pi-answer", "@scope/pkg@1.0" → "@scope/pkg")
        const spec = parsed.source.slice("npm:".length).trim();
        const atIdx = spec.indexOf("@");
        const slashIdx = spec.indexOf("/");
        let name: string;
        if (spec.startsWith("@") && slashIdx !== -1) {
          // Scoped package: @scope/pkg@version → @scope/pkg
          const versionAt = spec.indexOf("@", slashIdx);
          name = versionAt !== -1 ? spec.slice(0, versionAt) : spec;
        } else if (atIdx !== -1) {
          // Unscoped: pkg@version → pkg
          name = spec.slice(0, atIdx);
        } else {
          name = spec;
        }
        installedPath = resolveNpmPackagePath(name, scope, cwd);
      } else if (parsed.type === "local") {
        const resolved = parsed.source.startsWith(".")
          ? join(scope === "global" ? homedir() : cwd, parsed.source)
          : parsed.source;
        installedPath = resolved;
      }

      if (!installedPath || !existsSync(installedPath)) continue;

      let stat;
      try {
        stat = statSync(installedPath);
      } catch {
        continue;
      }

      const name = basename(installedPath);
      const isDir = stat.isDirectory();

      // Only add if it looks like a valid extension source
      if (!isDir) continue;

      const hasExtensions = existsSync(join(installedPath, "extensions"))
        || existsSync(join(installedPath, "index.ts"))
        || existsSync(join(installedPath, "index.js"))
        || existsSync(join(installedPath, "package.json"));

      if (!hasExtensions) continue;

      extensions.push({
        name,
        path: installedPath,
        scope,
        type: "directory",
        disabled: false,
        source: parsed.source,
      });
    }
  }

  return extensions;
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

  // Add package-discovered extensions, avoiding duplicates by path
  const existingPaths = new Set(extensions.map((e) => e.path));
  for (const pkgExt of discoverPackageExtensions(cwd)) {
    if (!existingPaths.has(pkgExt.path)) {
      extensions.push(pkgExt);
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
              const typeLabel = ext.source
                ? (ext.source.startsWith("npm:") ? "npm" : ext.source.startsWith("git:") ? "git" : "local")
                : (isDir ? "Package" : "Script");

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
            const typeLabel = ext.source
              ? (ext.source.startsWith("npm:") ? "npm" : ext.source.startsWith("git:") ? "git" : "local")
              : (isDir ? "Package" : "Script");
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
                    await writeSettings(settingsPath, settings);
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
            return;
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
          const openResult = await pi.exec(editor, [filePath]);

          if (openResult.code === 0) {
            ctx.ui.notify(`Opened ${ext.name} in ${editor}`, "info");
          } else {
            ctx.ui.notify(`Failed to open: ${openResult.stderr || "unknown error"}`, "error");
          }
        }
      } else {
        // Print mode: output to console
        console.log(lines.join("\n"));
      }
    },
  });
}
