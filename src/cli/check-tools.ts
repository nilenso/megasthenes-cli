/**
 * Preflight check for system tools the megasthenes library shells out to.
 *
 * In local mode the library invokes `git` (clone), `rg` (ripgrep), and `fd`
 * directly. We surface missing tools with a clear, actionable error instead
 * of letting the library fail mid-turn with a cryptic exec error.
 *
 * Skipped automatically when sandbox mode is active — the worker provides
 * those tools, the local host doesn't need them.
 *
 * macOS and Linux only.
 */

import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

export const REQUIRED_TOOLS = ["git", "rg", "fd"] as const;
export type RequiredTool = (typeof REQUIRED_TOOLS)[number];

const INSTALL_HINTS: Record<RequiredTool, string> = {
	git: "git",
	rg: "ripgrep",
	fd: "fd (Debian/Ubuntu installs as `fdfind`; symlink it: `sudo ln -s $(which fdfind) /usr/local/bin/fd`)",
};

/** Returns the names of tools missing from PATH. Empty array means all present. */
export function findMissingTools(
	tools: readonly string[] = REQUIRED_TOOLS,
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	const pathEntries = (env.PATH ?? "").split(delimiter).filter(Boolean);
	return tools.filter((tool) => !isOnPath(tool, pathEntries));
}

function isOnPath(tool: string, pathEntries: readonly string[]): boolean {
	for (const dir of pathEntries) {
		const candidate = join(dir, tool);
		try {
			const s = statSync(candidate);
			if (!s.isFile()) continue;
			accessSync(candidate, constants.X_OK);
			return true;
		} catch {
			// not present or not executable; keep looking
		}
	}
	return false;
}

export function formatMissingToolsError(missing: readonly string[]): string {
	const lines = [
		`error: required tool${missing.length === 1 ? "" : "s"} not found on PATH: ${missing.join(", ")}`,
		"",
		"megasthenes shells out to these tools to clone and search the repository.",
		"Install the missing one(s):",
		"",
	];
	for (const m of missing) {
		const hint = INSTALL_HINTS[m as RequiredTool] ?? m;
		lines.push(`  - ${m}  →  ${hint}`);
	}
	lines.push("");
	lines.push("Quick install:");
	lines.push("  macOS:          brew install git ripgrep fd");
	lines.push("  Debian/Ubuntu:  sudo apt install git ripgrep fd-find");
	lines.push("  Arch:           sudo pacman -S git ripgrep fd");
	lines.push("");
	lines.push("Or use sandbox mode to avoid the local dependency: --sandbox-base-url <url>");
	return `${lines.join("\n")}\n`;
}
