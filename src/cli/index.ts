#!/usr/bin/env node
/**
 * megasthenes CLI entry point.
 *
 * Currently dispatches the `ask` subcommand. Other subcommands (install-deps,
 * setup-sandbox) are owned by the upstream library binary.
 */

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
