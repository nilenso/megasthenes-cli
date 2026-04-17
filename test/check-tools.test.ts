import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "bun:test";
import { findMissingTools, formatMissingToolsError } from "../src/cli/check-tools.ts";

const sandbox = join(tmpdir(), `megasthenes-check-tools-${process.pid}-${Date.now()}`);
const binDir = join(sandbox, "bin");

beforeAll(() => {
	mkdirSync(binDir, { recursive: true });
});

function makeExecutable(name: string): void {
	const path = join(binDir, name);
	writeFileSync(path, "#!/bin/sh\nexit 0\n");
	chmodSync(path, 0o755);
}

describe("findMissingTools", () => {
	it("returns nothing when every tool is present and executable", () => {
		makeExecutable("git");
		makeExecutable("rg");
		makeExecutable("fd");
		expect(findMissingTools(undefined, { PATH: binDir })).toEqual([]);
	});

	it("flags tools that are missing from PATH", () => {
		const empty = join(sandbox, "empty");
		mkdirSync(empty, { recursive: true });
		expect(findMissingTools(undefined, { PATH: empty })).toEqual(["git", "rg", "fd"]);
	});

	it("handles an empty PATH gracefully", () => {
		expect(findMissingTools(undefined, { PATH: "" })).toEqual(["git", "rg", "fd"]);
		expect(findMissingTools(undefined, {})).toEqual(["git", "rg", "fd"]);
	});

	it("does not pick up non-executable files", () => {
		const nonExec = join(sandbox, "nonexec");
		mkdirSync(nonExec, { recursive: true });
		const path = join(nonExec, "git");
		writeFileSync(path, "x");
		chmodSync(path, 0o644);
		expect(findMissingTools(["git"], { PATH: nonExec })).toEqual(["git"]);
	});

	it("respects the actual host PATH for the real tools", () => {
		// Smoke test against the real environment — the dev box running these
		// tests almost certainly has git installed.
		expect(findMissingTools(["git"])).toEqual([]);
	});
});

describe("formatMissingToolsError", () => {
	it("mentions every missing tool and includes install hints", () => {
		const msg = formatMissingToolsError(["rg", "fd"]);
		expect(msg).toContain("rg");
		expect(msg).toContain("fd");
		expect(msg).toContain("brew install");
		expect(msg).toContain("apt install");
		expect(msg).toContain("--sandbox-base-url");
	});
});
