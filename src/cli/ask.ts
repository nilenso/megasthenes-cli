/**
 * `megasthenes ask` — main command flow.
 *
 * Builds typed configs, opens a Session, drives `session.ask()`, optionally
 * forwards stream events to stderr in --verbose mode, then renders the final
 * answer (markdown or JSON) and exits with a structured exit code.
 */

import { Client, type ErrorType, type StreamEvent } from "@nilenso/megasthenes";
import { ASK_HELP, ArgParseError, parseAskArgs } from "./ask-args.ts";
import { resolveConfig } from "./ask-config.ts";
import { extractFinalAnswer, formatSummary, renderMarkdown } from "./ask-render.ts";
import { findMissingTools, formatMissingToolsError } from "./check-tools.ts";

const ERROR_EXIT_CODES: Record<ErrorType, number> = {
	internal_error: 1,
	max_iterations: 2,
	context_overflow: 3,
	provider_error: 4,
	network_error: 4,
	empty_response: 4,
	aborted: 130,
};

export async function runAsk(argv: readonly string[]): Promise<number> {
	let parsed;
	try {
		parsed = parseAskArgs(argv);
	} catch (e) {
		if (e instanceof ArgParseError) {
			process.stderr.write(`error: ${e.message}\n\nRun 'megasthenes ask --help' for usage.\n`);
			return 64;
		}
		throw e;
	}

	if (parsed.help) {
		process.stdout.write(ASK_HELP);
		return 0;
	}

	let resolved;
	try {
		resolved = resolveConfig(parsed, process.env);
	} catch (e) {
		if (e instanceof ArgParseError) {
			process.stderr.write(`error: ${e.message}\n\nRun 'megasthenes ask --help' for usage.\n`);
			return 64;
		}
		throw e;
	}

	const { clientConfig, sessionConfig, askOptions, question, verbose, json } = resolved;

	// Preflight: in local mode the library shells out to git/rg/fd. Skip when
	// running against a sandbox worker (those tools live in the worker, not here).
	if (clientConfig.sandbox === undefined) {
		const missing = findMissingTools();
		if (missing.length > 0) {
			process.stderr.write(formatMissingToolsError(missing));
			return 1;
		}
	}

	const controller = new AbortController();
	const onSigInt = () => controller.abort();
	process.on("SIGINT", onSigInt);

	const client = new Client(clientConfig);
	let session;
	try {
		session = await client.connect(sessionConfig, (msg: string) => {
			if (verbose) process.stderr.write(`[clone] ${msg}\n`);
		});
	} catch (e) {
		process.off("SIGINT", onSigInt);
		const msg = e instanceof Error ? e.message : String(e);
		process.stderr.write(`error: failed to connect: ${msg}\n`);
		return 1;
	}

	try {
		const stream = session.ask(question, { ...askOptions, signal: controller.signal });

		if (verbose) {
			for await (const ev of stream) forwardEvent(ev);
		}

		const turn = await stream.result();

		if (json) {
			process.stdout.write(`${JSON.stringify(turn, null, 2)}\n`);
		} else {
			const answer = extractFinalAnswer(turn);
			if (answer) process.stdout.write(`${renderMarkdown(answer)}\n`);
			process.stderr.write(`${formatSummary(turn.usage, turn.metadata)}\n`);
		}

		if (turn.error) {
			process.stderr.write(`error: ${turn.error.message}\n`);
			if (verbose && turn.error.details !== undefined) {
				process.stderr.write(`details: ${safeStringify(turn.error.details)}\n`);
			}
			return ERROR_EXIT_CODES[turn.error.code] ?? 1;
		}
		return 0;
	} finally {
		process.off("SIGINT", onSigInt);
		try {
			session.close();
		} catch {
			// ignore close errors
		}
	}
}

function forwardEvent(ev: StreamEvent): void {
	switch (ev.type) {
		case "iteration_start":
			process.stderr.write(`· iter ${ev.index}\n`);
			return;
		case "tool_use_end":
			process.stderr.write(`· tool ${ev.name}(${summarizeParams(ev.params)})\n`);
			return;
		case "tool_result":
			if (ev.isError) {
				process.stderr.write(`· tool ${ev.name} failed (${ev.durationMs}ms)\n`);
			} else {
				process.stderr.write(`· tool ${ev.name} ok (${ev.durationMs}ms)\n`);
			}
			return;
		case "compaction":
			process.stderr.write(`· compacted ${ev.tokensBefore} → ${ev.tokensAfter} tokens\n`);
			return;
		case "error":
			process.stderr.write(`· error[${ev.code}] ${ev.message}\n`);
			return;
		default:
			return;
	}
}

function summarizeParams(params: Record<string, unknown>): string {
	const keys = Object.keys(params);
	if (keys.length === 0) return "";
	const first = keys[0]!;
	const v = params[first];
	const sv = typeof v === "string" ? `"${v.length > 40 ? `${v.slice(0, 40)}…` : v}"` : String(v);
	return keys.length === 1 ? `${first}=${sv}` : `${first}=${sv}, …`;
}

function safeStringify(v: unknown): string {
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
}
