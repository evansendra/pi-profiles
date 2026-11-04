import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createProfiles, launchCommand } from "../lib/profiles.ts";
import { buildExport, importBundle, parseExportArguments, previewBundle, readBundle, restoreGuide, splitArguments, writeBundle } from "../lib/transfer.ts";

export default function (pi: ExtensionAPI) {
  const directory = resolve(getAgentDir());
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const profiles = createProfiles(homedir(), directory, root);
  const usage = "Usage: /profiles [list | NAME | new NAME | remove NAME | [--dry-run] SOURCE TARGET | export NAME [--path FILE_OR_DIRECTORY] [--dry-run] | import FILE [NEW_NAME] [--dry-run]]";
  const localPath = (path: string, cwd: string) => resolve(cwd, path.startsWith("~/") ? homedir() + path.slice(1) : path);
  pi.registerCommand("profiles", {
    description: "List, create, remove, sync, export, or import profiles",
    getArgumentCompletions: (prefix) => {
      const entries = profiles.list();
      const names = entries.map((entry) => ({
        value: entry.name,
        label: `${entry.current ? "* " : ""}${entry.name}`,
        description: entry.directory,
      }));
      const hints = [
        { value: "list", label: "list", description: "List profiles, directories, and launch commands" },
        { value: "new ", label: "new <name>", description: "Create a fresh profile" },
        { value: "remove ", label: "remove <name>", description: "Delete a profile with confirmation" },
        { value: "export ", label: "export <name> [--path file_or_directory]", description: "Export portable preferences and local text resources" },
        { value: "import ", label: "import <file> [new_name]", description: "Preview and restore into a fresh profile" },
        { value: "--dry-run ", label: "--dry-run <source> <target>", description: "Preview settings sync without writing" },
        { value: "", label: "<source> <target>", description: "Sync settings between existing profiles; type a source, then a target" },
        ...names.map((entry) => ({ ...entry, description: `Show launch command, or append a target to sync; ${entry.description}` })),
      ];
      const words = prefix.trimStart().split(/\s+/);
      let candidates = hints;
      let start = "";
      let partial = prefix.trimStart();
      if (words.length > 1) {
        partial = words.pop()!;
        start = words.join(" ") + " ";
        if (words[0] === "remove" && words.length === 1) {
          candidates = names.filter((entry) => entry.value !== "main" && !entries.find((profile) => profile.name === entry.value)?.current);
        } else if (words[0] === "export" && words.length === 1) {
          candidates = names;
        } else if (words[0] === "export" && words.length === 2) {
          candidates = [
            { value: "--path ", label: "--path <file_or_directory>", description: "Choose the export destination" },
            { value: "--dry-run", label: "--dry-run", description: "Preview without writing" },
          ];
        } else if (words[0] === "--dry-run" && words.length <= 2) {
          candidates = names.filter((entry) => entry.value !== words[1]);
        } else if (words.length === 1 && entries.some((entry) => entry.name === words[0])) {
          candidates = names.filter((entry) => entry.value !== words[0]);
        } else if (words.length === 2 && words.every((word) => entries.some((entry) => entry.name === word))) {
          candidates = [{ value: "--dry-run", label: "--dry-run", description: "Preview instead of syncing" }];
        } else {
          return null;
        }
      }
      const matches = candidates.filter((entry) => entry.value.startsWith(partial))
        .map((entry) => ({ ...entry, value: start + entry.value }));
      return matches.length ? matches : null;
    },
    handler: async (args, ctx) => {
      try {
        const tokens = splitArguments(args);
        const dryRun = tokens.includes("--dry-run");
        const words = tokens.filter((word) => word !== "--dry-run");
        if (!words.length || (words.length === 1 && words[0] === "list")) {
          if (dryRun) throw new Error(usage);
          const rows = profiles.list().map((entry) => `${entry.current ? "* " : "  "}${entry.name} → ${entry.directory}\n    ${launchCommand(entry.directory)}`);
          ctx.ui.notify(`${rows.join("\n")}\n\n* Current profile. Launch in another terminal, or exit Pi first.\nTemplate: PI_CODING_AGENT_DIR='<config-dir>' pi\n/profiles NAME shows its launch command; this does not switch the running session.`, "info");
          return;
        }
        if (words[0] === "export") {
          const options = parseExportArguments(words.slice(1));
          const entry = profiles.find(options.name);
          if (!entry) throw new Error(`Profile '${options.name}' doesn't exist.`);
          const bundle = buildExport(entry);
          let output = localPath(options.output ?? `${entry.name}.pi-profile.json`, ctx.cwd);
          if (statSync(output, { throwIfNoEntry: false })?.isDirectory()) output = join(output, `${entry.name}.pi-profile.json`);
          const preview = previewBundle(bundle);
          ctx.ui.notify(`Destination: ${output}\n\n${preview}`, "info");
          if (dryRun) return;
          if (!ctx.hasUI) throw new Error("Export requires interactive confirmation; use --dry-run to preview.");
          if (!(await ctx.ui.confirm("Export this profile?", `Write ${output}? Review the listed files before sharing: text resources may contain private data or code instructions. MCP configuration and credentials are excluded; there is no automatic secret detection.`))) {
            ctx.ui.notify("Export cancelled.", "info");
            return;
          }
          writeBundle(output, bundle);
          ctx.ui.notify(`Exported to ${output}. Existing files are never overwritten. Review its contents before transferring.`, "info");
          return;
        }
        if (words[0] === "import" && words.length >= 2 && words.length <= 3) {
          const bundle = readBundle(localPath(words[1], ctx.cwd));
          const name = words[2] ?? "imported";
          if (profiles.find(name)) throw new Error(`Profile '${name}' already exists; supply a different new name.`);
          ctx.ui.notify(previewBundle(bundle), "info");
          if (dryRun) return;
          if (!ctx.hasUI) throw new Error("Import requires interactive confirmation; use --dry-run to preview.");
          if (!(await ctx.ui.confirm(`Import into new profile '${name}'?`, "Review the bundle first. Skill and prompt text can influence the model and request code execution when the profile is used. Packages and MCPs will NOT be installed or executed. Authenticate separately on this machine."))) {
            ctx.ui.notify("Import cancelled.", "info");
            return;
          }
          const entry = importBundle(profiles, bundle, name);
          ctx.ui.notify(`Imported ${name} → ${entry.directory}\nRestoration checklist: ${entry.directory}/RESTORE.txt\n\n${restoreGuide(bundle, entry.directory)}`, "info");
          return;
        }
        if (words.length === 2 && words[0] === "new" && !dryRun) {
          const entry = profiles.create(words[1]);
          ctx.ui.notify(`${entry.created ? "Created" : "Already exists:"} ${entry.name} → ${entry.directory}\n${launchCommand(entry.directory)}\n${entry.created ? "Fresh profile; use /login after launching. No settings or credentials copied." : ""}`, "info");
          return;
        }
        if (words.length === 2 && words[0] === "remove" && !dryRun) {
          const entry = profiles.find(words[1]);
          if (!entry) throw new Error(`Profile '${words[1]}' doesn't exist.`);
          profiles.assertRemovable(entry);
          if (!ctx.hasUI) throw new Error("Removing a profile requires interactive confirmation.");
          if (!(await ctx.ui.confirm(`Remove profile '${entry.name}'?`, `Permanently delete ${entry.directory}, including credentials, settings, and all session history? Close any other Pi sessions using this profile first.`))) {
            ctx.ui.notify("Removal cancelled.", "info");
            return;
          }
          profiles.remove(entry);
          ctx.ui.notify(`Removed ${entry.name} → ${entry.directory}`, "info");
          return;
        }
        if (words.length === 1 && !dryRun) {
          const entry = profiles.find(words[0]);
          if (!entry) throw new Error(`Profile '${words[0]}' doesn't exist.`);
          ctx.ui.notify(entry.current
            ? `${entry.name} (current) → ${entry.directory}`
            : `to switch to this profile, in a new session/shell, run:\n\n\`\`\`sh\n${launchCommand(entry.directory)}\n\`\`\``, "info");
          return;
        }
        if (words.length === 2 && !words.some((word) => word.startsWith("--"))) {
          const source = profiles.find(words[0]);
          const target = profiles.find(words[1]);
          if (!source || !target) throw new Error(`Profile '${!source ? words[0] : words[1]}' doesn't exist. Nothing changed.`);
          ctx.ui.notify(profiles.sync(source, target, dryRun), "info");
          return;
        }
        throw new Error(usage);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
