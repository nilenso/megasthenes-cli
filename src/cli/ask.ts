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
import {
	extractFinalAnswer,
	formatActivity,
	formatSetupLine,
	formatSummary,
	formatToolLine,
	renderMarkdown,
} from "./ask-render.ts";
import { findMissingTools, formatMissingToolsError } from "./check-tools.ts";
import { setupTracing, shutdownTracing } from "./tracing.ts";
import { StatusLine, sym, ui } from "./ui.ts";

const ERROR_EXIT_CODES: Record<ErrorType, number> = {
	internal_error: 1,
	max_iterations: 2,
	context_overflow: 3,
	provider_error: 4,
	network_error: 4,
	empty_response: 4,
	clone_failed: 1,
	fetch_failed: 1,
	invalid_commitish: 64,
	invalid_config: 64,
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

	const { clientConfig, sessionConfig, askOptions, question, verbose, json, tracingEndpoint } =
		resolved;

	if (tracingEndpoint !== undefined) {
		setupTracing(tracingEndpoint);
		if (verbose) process.stderr.write(`${formatSetupLine("tracing", tracingEndpoint)}\n`);
	}

	// Preflight: in local mode the library shells out to git/rg/fd. Skip when
	// running against a sandbox worker (those tools live in the worker, not here).
	if (clientConfig.sandbox === undefined) {
		const missing = findMissingTools();
		if (missing.length > 0) {
			process.stderr.write(formatMissingToolsError(missing));
			return 1;
		}
	} else {
		const baseUrl = clientConfig.sandbox.baseUrl;
		const sandboxStatus = new StatusLine();
		// On a TTY we flash the neutral diamond while the probe runs, then
		// overwrite with ✓/✗. On non-TTY streams `update` would append a second
		// line, so we skip straight to the final result.
		if (ui.tty) sandboxStatus.update(formatSetupLine("sandbox", baseUrl));
		const healthy = await probeSandboxHealth(baseUrl);
		const icon = healthy ? ui.green(sym.check) : ui.red(sym.cross);
		sandboxStatus.finalize(formatSetupLine("sandbox", baseUrl, icon));
	}

	const controller = new AbortController();
	const onSigInt = () => controller.abort();
	process.on("SIGINT", onSigInt);

	const client = new Client(clientConfig);
	let session;
	const cloneStatus = new StatusLine();
	try {
		session = await client.connect(sessionConfig, (msg: string) => {
			if (verbose) cloneStatus.update(formatSetupLine("cloning", ui.dim(msg)));
		});
		if (verbose) {
			cloneStatus.finalize(
				formatSetupLine("cloned", ui.dim("repository ready"), ui.green(sym.check)),
			);
		}
	} catch (e) {
		cloneStatus.clear();
		process.off("SIGINT", onSigInt);
		const msg = e instanceof Error ? e.message : String(e);
		process.stderr.write(`  ${ui.red(sym.cross)} ${ui.bold("connect failed")} ${ui.dim(msg)}\n`);
		return 1;
	}

	try {
		const stream = session.ask(question, { ...askOptions, signal: controller.signal });

		if (verbose) {
			// Blank line separates the setup block from the agent's work.
			process.stderr.write("\n");
			// tool_result doesn't carry params; remember them from tool_use_end so we
			// can render a single, self-contained line per tool call.
			const pendingParams = new Map<string, Record<string, unknown>>();
			for await (const ev of stream) forwardEvent(ev, pendingParams);
		}

		const turn = await stream.result();

		if (json) {
			process.stdout.write(`${JSON.stringify(turn, null, 2)}\n`);
		} else {
			const answer = extractFinalAnswer(turn);
			if (answer) {
				// Breathing room between the agent trace and the rendered answer.
				if (verbose) process.stderr.write("\n");
				process.stdout.write(`${renderMarkdown(answer)}\n`);
			}
			process.stderr.write(`${formatSummary(turn.usage, turn.metadata, !turn.error)}\n`);
		}

		if (turn.error) {
			process.stderr.write(
				`  ${ui.red(sym.cross)} ${ui.bold(turn.error.errorType)} ${ui.dim(turn.error.message)}\n`,
			);
			if (verbose && turn.error.details !== undefined) {
				process.stderr.write(ui.dim(`    details: ${safeStringify(turn.error.details)}\n`));
			}
			return ERROR_EXIT_CODES[turn.error.errorType] ?? 1;
		}
		return 0;
	} finally {
		process.off("SIGINT", onSigInt);
		try {
			session.close();
		} catch {
			// ignore close errors
		}
		// Flush pending spans before the process exits.
		await shutdownTracing();
	}
}

/**
 * Render a single stream event as a line on stderr. We intentionally skip
 * iteration_start and tool_use_* events — each tool call is summarized once,
 * on tool_result, using the params we stashed from tool_use_end.
 */
function forwardEvent(ev: StreamEvent, pendingParams: Map<string, Record<string, unknown>>): void {
	switch (ev.type) {
		case "tool_use_end":
			pendingParams.set(ev.toolCallId, ev.params);
			return;
		case "tool_result": {
			const params = pendingParams.get(ev.toolCallId);
			pendingParams.delete(ev.toolCallId);
			process.stderr.write(`${formatToolLine(ev.name, params, ev.durationMs, ev.isError)}\n`);
			return;
		}
		case "compaction":
		case "error": {
			const line = formatActivity(ev);
			if (line) process.stderr.write(`${line}\n`);
			return;
		}
		default:
			return;
	}
}

function safeStringify(v: unknown): string {
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
}

/**
 * Hit `<baseUrl>/health` with a short timeout and return true only if the
 * worker replies with HTTP 2xx and a JSON body `{ ok: true }`. Any other
 * outcome — missing URL, timeout, non-2xx, invalid JSON, `ok: false` — is
 * a fail.
 */
async function probeSandboxHealth(baseUrl: string, timeoutMs = 800): Promise<boolean> {
	if (!baseUrl) return false;
	const url = `${baseUrl.replace(/\/+$/, "")}/health`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: controller.signal });
		if (!res.ok) return false;
		const body = (await res.json()) as unknown;
		return (
			typeof body === "object" && body !== null && (body as Record<string, unknown>).ok === true
		);
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}
