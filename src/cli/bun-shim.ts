/**
 * Runtime compatibility shim: when running under Node.js, install a minimal
 * `Bun` global so the upstream `@nilenso/megasthenes` library (which calls
 * `Bun.spawn` / `Bun.sleep` unconditionally) works without changes.
 *
 * Must be imported before any module that references the `Bun` global. In
 * this CLI, `src/cli/index.ts` imports this file first, before any code
 * that transitively pulls in megasthenes.
 */

import { type ChildProcess, type StdioOptions, spawn as nodeSpawn } from "node:child_process";
import { Readable } from "node:stream";

type BunStdio = "pipe" | "inherit" | "ignore";

interface BunSpawnOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	stdout?: BunStdio;
	stderr?: BunStdio;
	stdin?: BunStdio;
}

interface BunSubprocess {
	readonly stdout: ReadableStream<Uint8Array> | null;
	readonly stderr: ReadableStream<Uint8Array> | null;
	readonly exited: Promise<number>;
	readonly exitCode: number | null;
	kill(signal?: NodeJS.Signals | number): void;
}

function resolveStdio(pref: BunStdio | undefined, fallback: BunStdio): BunStdio {
	return pref ?? fallback;
}

function toWeb(stream: Readable | null): ReadableStream<Uint8Array> | null {
	if (!stream) return null;
	// Node ≥ 17 has Readable.toWeb; the types ship as `ReadableStream<any>` so
	// cast to the byte-stream shape that `new Response(stream).text()` expects.
	return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

function spawnShim(cmd: readonly string[], options: BunSpawnOptions = {}): BunSubprocess {
	if (cmd.length === 0) throw new Error("Bun.spawn: empty command array");
	const [file, ...args] = cmd as [string, ...string[]];

	const stdio: StdioOptions = [
		resolveStdio(options.stdin, "ignore"),
		resolveStdio(options.stdout, "pipe"),
		resolveStdio(options.stderr, "pipe"),
	];

	const child: ChildProcess = nodeSpawn(file, args, {
		cwd: options.cwd,
		env: options.env ?? process.env,
		stdio,
	});

	// Bun resolves `.exited` with the numeric exit code. For signal-terminated
	// processes we follow the POSIX convention of 128 + signal-number-ish; the
	// library only cares about `=== 0` vs non-zero, so any non-zero works.
	const exited = new Promise<number>((resolve) => {
		child.once("exit", (code, signal) => {
			if (code !== null) resolve(code);
			else if (signal) resolve(128);
			else resolve(1);
		});
		child.once("error", () => resolve(127));
	});

	const stdoutStream = toWeb(child.stdout);
	const stderrStream = toWeb(child.stderr);

	return {
		get stdout() {
			return stdoutStream;
		},
		get stderr() {
			return stderrStream;
		},
		get exited() {
			return exited;
		},
		get exitCode() {
			return child.exitCode;
		},
		kill(signal) {
			child.kill(signal);
		},
	};
}

function sleepShim(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Install the shim on globalThis without touching the global TypeScript
// namespace — JSR's publish rules forbid `declare global` in published code.
// The runtime attach is all the downstream library needs; consumers that
// want `Bun` as a typed global should pull `@types/bun` themselves.
type BunGlobal = { spawn: typeof spawnShim; sleep: typeof sleepShim };
const g = globalThis as unknown as { Bun?: BunGlobal };
if (typeof g.Bun === "undefined") {
	g.Bun = { spawn: spawnShim, sleep: sleepShim };
}
