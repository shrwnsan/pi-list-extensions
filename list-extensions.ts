import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

interface ExtensionInfo {
  name: string;
  path: string;
  scope: "global" | "project";
  type: "file" | "directory";
}

function discoverExtensions(cwd: string): ExtensionInfo[] {
  const extensions: ExtensionInfo[] = [];

  const locations = [
    { dir: join(homedir(), ".pi", "agent", "extensions"), scope: "global" as const },
    { dir: join(cwd, ".pi", "extensions"), scope: "project" as const },
  ];

  for (const { dir, scope } of locations) {
    if (!existsSync(dir)) continue;

    try {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        // Skip hidden files and .DS_Store
        if (entry.startsWith(".")) continue;

        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isFile() && (entry.endsWith(".ts") || entry.endsWith(".js"))) {
          // Direct file extension
          extensions.push({
            name: basename(entry, entry.endsWith(".ts") ? ".ts" : ".js"),
            path: fullPath,
            scope,
            type: "file",
          });
        } else if (stat.isDirectory()) {
          // Check for index.ts or package.json with pi field
          const indexPath = join(fullPath, "index.ts");
          const indexJsPath = join(fullPath, "index.js");
          const packagePath = join(fullPath, "package.json");

          if (existsSync(indexPath) || existsSync(indexJsPath)) {
            extensions.push({
              name: entry,
              path: fullPath,
              scope,
              type: "directory",
            });
          } else if (existsSync(packagePath)) {
            // Package with pi field
            extensions.push({
              name: entry,
              path: fullPath,
              scope,
              type: "directory",
            });
          }
        }
      }
    } catch (e) {
      // Skip directories we can't read
    }
  }

  return extensions;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("extensions", {
    description: "List all installed pi extensions",
    handler: async (args, ctx) => {
      const extensions = discoverExtensions(ctx.cwd);

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
          if (verbose) {
            lines.push(`  ${icon} ${ext.name}`);
            lines.push(`     ${ext.path}`);
          } else {
            lines.push(`  ${icon} ${ext.name}`);
          }
        }
      }

      if (project.length > 0) {
        if (global.length > 0) lines.push("");
        lines.push(`Project (.pi/extensions/):`);
        for (const ext of project) {
          const icon = ext.type === "directory" ? "📁" : "📄";
          if (verbose) {
            lines.push(`  ${icon} ${ext.name}`);
            lines.push(`     ${ext.path}`);
          } else {
            lines.push(`  ${icon} ${ext.name}`);
          }
        }
      }

      if (ctx.hasUI) {
        const extByPath = new Map(extensions.map((ext) => [ext.path, ext]));

        const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
          // Generate items inside the callback to use theme colors
          const selectItems: SelectItem[] = extensions.map((ext) => {
            const isDir = ext.type === "directory";
            // Icons: ⚡ (Bolt) for scripts, 📦 (Package) for directories
            const iconSymbol = isDir ? "📦" : "⚡";
            // Colors: Info (Cyan/Blue) for scripts, Warning (Yellow/Orange) for packages
            const icon = isDir ? theme.fg("warning", iconSymbol) : theme.fg("accent", iconSymbol);
            
            const scopeLabel = ext.scope === "project" ? "Project" : "Global";
            const typeLabel = isDir ? "Package" : "Script";
            
            return {
              value: ext.path,
              // Add extra space after icon for visual breathing room
              label: `${icon}  ${ext.name}`,
              description: `${scopeLabel} ${theme.fg("dim", "•")} ${typeLabel}`,
            };
          });

          const container = new Container();

          const title = new Text(theme.fg("accent", theme.bold("Extensions Library")), 1, 0);
          const subtitle = new Text(
            theme.fg(
              "dim",
              `${extensions.length} installed • ${global.length} global • ${project.length} project`,
            ),
            1,
            0,
          );

          const detailText = new Text("", 1, 0);

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
            const icon = isDir ? theme.fg("warning", iconSymbol) : theme.fg("accent", iconSymbol);
            const typeLabel = isDir ? "Package" : "Script";
            const scopeLabel = ext.scope === "project" ? "Project" : "Global";

            const lines = [
              `${theme.fg("accent", "Selected:")} ${icon} ${theme.bold(ext.name)} ${theme.fg("dim", "•")} ${typeLabel} ${theme.fg("dim", "•")} ${scopeLabel}`,
              `${theme.fg("muted", "Path:")} ${theme.fg("dim", ext.path)}`,
            ];

            detailText.setText(lines.join("\n"));
          };

          // Top border
          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
          container.addChild(title);
          container.addChild(subtitle);

          // SelectList with theme
          const selectList = new SelectList(selectItems, Math.min(selectItems.length, 20), {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("warning", t),
          });

          selectList.onSelect = (item) => done(item.value);
          selectList.onCancel = () => done(null);
          selectList.onSelectionChange = (item) => {
            updateDetails(item);
            tui.requestRender();
          };

          updateDetails(selectList.getSelectedItem());

          container.addChild(selectList);
          container.addChild(detailText);

          // Help text (customized)
          container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter open • esc close"), 1, 0));

          // Bottom border
          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

          return {
            render: (w) => container.render(w),
            invalidate: () => container.invalidate(),
            handleInput: (data) => {
              selectList.handleInput(data);
              tui.requestRender();
            },
          };
        });

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
