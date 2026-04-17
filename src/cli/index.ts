#!/usr/bin/env node
/**
 * megasthenes CLI entry point.
 *
 * Currently dispatches the `ask` subcommand. Other subcommands (install-deps,
 * setup-sandbox) are owned by the upstream library binary.
 */

import { runAsk } from "./ask.ts";
import { TOP_HELP } from "./ask-args.ts";

const command = process.argv[2];

switch (command) {
	case "ask":
		process.exit(await runAsk(process.argv.slice(3)));
	// biome-ignore lint/suspicious/noFallthroughSwitchClause: intentional
	case undefined:
	case "--help":
	case "-h":
		process.stdout.write(TOP_HELP);
		process.exit(0);
	default:
		process.stderr.write(`Unknown command: ${command}\nRun 'megasthenes --help' for usage.\n`);
		process.exit(1);
}
