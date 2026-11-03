import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createProfiles, launchCommand } from "../lib/profiles.mjs";

export default function (pi: ExtensionAPI) {
  const directory = resolve(getAgentDir());
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const profiles = createProfiles(homedir(), directory, root);
  const usage = "Usage: /profiles [list | NAME | new NAME | remove NAME | [--dry-run] SOURCE TARGET]";
  pi.registerCommand("profiles", {
    description: "List, create, remove, or sync profiles; show a profile's launch command",
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
        const tokens = args.trim().split(/\s+/).filter(Boolean);
        const dryRun = tokens.includes("--dry-run");
        const words = tokens.filter((word) => word !== "--dry-run");
        if (!words.length || (words.length === 1 && words[0] === "list")) {
          if (dryRun) throw new Error(usage);
          const rows = profiles.list().map((entry) => `${entry.current ? "* " : "  "}${entry.name} → ${entry.directory}\n    ${launchCommand(entry.directory)}`);
          ctx.ui.notify(`${rows.join("\n")}\n\n* Current profile. Launch in another terminal, or exit Pi first.\nTemplate: PI_CODING_AGENT_DIR='<config-dir>' pi\n/profiles NAME shows its launch command; this does not switch the running session.`, "info");
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
