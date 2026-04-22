/**
 * megasthenes CLI entry point.
 *
 * Dispatches the `ask` subcommand. `./bun-shim.ts` MUST be imported before
 * anything that pulls in the upstream megasthenes library — the library
 * calls `Bun.spawn` / `Bun.sleep` unconditionally, and the shim polyfills
 * those onto `globalThis` via `node:child_process`. ESM guarantees this
 * file's top-level side effects run in source order.
 */

import "./bun-shim.ts";
import { TOP_HELP } from "./ask-args.ts";
import { runAsk } from "./ask.ts";

const command = process.argv[2];

if (command === "ask") {
	process.exit(await runAsk(process.argv.slice(3)));
}

if (command === undefined || command === "--help" || command === "-h") {
	process.stdout.write(TOP_HELP);
	process.exit(0);
}

process.stderr.write(`Unknown command: ${command}\nRun 'megasthenes --help' for usage.\n`);
process.exit(1);
