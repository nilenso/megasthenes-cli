/**
 * Render helpers: extract the final assistant answer from a TurnResult and
 * render markdown for the terminal. Also formats the stderr activity lines
 * and end-of-turn summary.
 */

import type { StreamEvent, TokenUsage, TurnMetadata, TurnResult } from "@nilenso/megasthenes";
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { sym, ui } from "./ui.ts";

// Answer-block geometry. The rendered markdown is left-padded by ANSWER_INDENT
// and wrapped to ANSWER_MAX_WIDTH columns so paragraphs stay at a comfortable
// reading width on wide terminals; rules frame the block to separate it from
// the activity log above and the summary below.
const ANSWER_INDENT = "  ";
const ANSWER_MAX_WIDTH = 88;
const ANSWER_MIN_WIDTH = 40;

/**
 * The "final answer" is the trailing assistant text — every assistant text
 * step that comes after the last tool call. If there were no tool calls, all
 * assistant text steps are concatenated.
 */
export function extractFinalAnswer(turn: TurnResult): string {
	const steps = turn.steps;
	let lastToolCallIdx = -1;
	for (let i = steps.length - 1; i >= 0; i--) {
		if (steps[i]!.type === "tool_call") {
			lastToolCallIdx = i;
			break;
		}
	}

	const parts: string[] = [];
	for (let i = lastToolCallIdx + 1; i < steps.length; i++) {
		const s = steps[i]!;
		if (s.type === "text" && s.role === "assistant") parts.push(s.text);
	}
	return parts.join("\n\n").trim();
}

/**
 * Render the assistant's markdown answer as an indented, wrapped block framed
 * by horizontal rules. The rules + indent give the answer a clear visual box
 * that separates it from the surrounding activity and summary lines without
 * drawing a full border.
 */
export function renderMarkdown(text: string): string {
	if (!text) return "";

	const cols = process.stdout.columns ?? 100;
	const width = Math.max(
		ANSWER_MIN_WIDTH,
		Math.min(ANSWER_MAX_WIDTH, cols - ANSWER_INDENT.length * 2),
	);

	// Reconstruct per render so resizes take effect and the wrap width matches
	// the current TTY. The cost is negligible compared to the LLM call.
	//
	// `reflowText` is left off on purpose: marked-terminal's reflow only strips
	// CSI SGR codes when measuring word width and is blind to OSC 8 hyperlink
	// escapes, so it happily wraps *inside* the `ESC ]8;;URL BEL … ESC ]8;; BEL`
	// sequence — the terminal then extends the link's underline/hover region
	// onto the following text. Our wrapAnsiLine below handles OSC 8 correctly
	// and keeps each hyperlink sequence as a single atomic token.
	type TextFn = (
		this: { parser: { parseInline: (t: unknown[]) => string } },
		token: unknown,
	) => string;
	const ext = markedTerminal({ width, reflowText: false }) as unknown as {
		renderer: Record<string, TextFn>;
	};
	// Fix a marked-terminal bug: its `text` renderer takes `token.text` (the
	// raw markdown source) and drops `token.tokens`, so inline children of
	// tight-list text tokens — links, bold, code — never render. Marked's own
	// default text renderer calls parseInline on the child tokens; replicate
	// that when tokens are present and defer to the original otherwise.
	const origText = ext.renderer.text as TextFn;
	ext.renderer.text = function (token) {
		if (
			token &&
			typeof token === "object" &&
			Array.isArray((token as { tokens?: unknown }).tokens)
		) {
			return this.parser.parseInline((token as { tokens: unknown[] }).tokens);
		}
		return origText.call(this, token);
	};
	const m = new Marked(ext as never);

	let body: string;
	try {
		const out = m.parse(text);
		body = typeof out === "string" ? out : text;
	} catch {
		body = text;
	}

	const wrapped = body
		.trimEnd()
		.split("\n")
		.flatMap((line) => wrapAnsiLine(line, width));
	const indented = wrapped.map((line) => `${ANSWER_INDENT}${line}`).join("\n");
	const rule = ui.dim("─".repeat(width));
	return `${ANSWER_INDENT}${rule}\n\n${indented}\n\n${ANSWER_INDENT}${rule}`;
}

// Strip ANSI escapes before measuring — colored text should wrap at its visible
// width, not the raw byte length (which includes invisible color codes).
// Matches both CSI SGR color codes (`ESC [ ... m`) and OSC 8 hyperlink escapes
// (`ESC ] 8 ; ; URL ST`) — without OSC 8, long URLs count toward the visible
// width and the wrapper breaks link-bearing lines mid-hyperlink.
// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC/BEL are the actual bytes we match.
const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const visibleLen = (s: string): number => s.replace(ANSI_RE, "").length;

/**
 * Word-wrap a single rendered line to `width` visible columns. Continuation
 * lines re-indent to match the original line's leading whitespace so wrapped
 * list items stay visually aligned under their bullet. ANSI style runs can
 * be broken mid-wrap — accepted trade-off to keep the implementation tiny.
 */
function wrapAnsiLine(line: string, width: number): string[] {
	if (visibleLen(line) <= width) return [line];

	const leading = line.match(/^(\s*)/)?.[1] ?? "";
	const tokens = line.split(/(\s+)/);
	const out: string[] = [];
	let cur = "";
	let curLen = 0;
	// Only break when the current buffer actually holds non-whitespace content.
	// Without this guard, two consecutive oversize tokens emit an empty
	// whitespace-only line between them (the indent left over from the prior
	// break, with no text attached).
	let curHasText = false;
	for (const tok of tokens) {
		if (!tok) continue;
		const tl = visibleLen(tok);
		const tokIsSpace = /^\s+$/.test(tok);
		if (curLen + tl > width && curHasText) {
			out.push(cur);
			cur = tokIsSpace ? leading : leading + tok;
			curLen = visibleLen(cur);
			curHasText = !tokIsSpace;
		} else {
			cur += tok;
			curLen += tl;
			if (!tokIsSpace) curHasText = true;
		}
	}
	if (curHasText) out.push(cur);
	return out;
}

// Column widths chosen to fit the longest common label / tool name with a
// little breathing room. If names outgrow these, rows will simply extend.
const SETUP_LABEL_WIDTH = 8;
const TOOL_NAME_WIDTH = 6;

/** A labeled setup line, e.g. `  ◇ sandbox   http://localhost:8080`. */
export function formatSetupLine(label: string, value: string, icon?: string): string {
	const marker = icon ?? ui.cyan(sym.diamond);
	return `  ${marker} ${ui.dim(label.padEnd(SETUP_LABEL_WIDTH))} ${value}`;
}

/**
 * Format a completed tool call as a single activity line. Params from
 * tool_use_end must be threaded through by the caller since tool_result
 * events don't carry them.
 */
export function formatToolLine(
	name: string,
	params: Record<string, unknown> | undefined,
	durationMs: number,
	isError: boolean,
): string {
	const icon = isError ? ui.red(sym.cross) : ui.green(sym.check);
	const paddedName = ui.bold(name.padEnd(TOOL_NAME_WIDTH));
	const paramStr = params ? summarizeParams(params) : "";
	const paramPart = paramStr ? `${ui.dim(paramStr)} ` : "";
	return `  ${icon} ${paddedName} ${paramPart}${ui.dim(`· ${durationMs}ms`)}`;
}

/**
 * Format a non-tool stream event (compaction, error) as an activity line.
 * Returns null for events that shouldn't produce their own line — tool
 * events are handled by the caller via formatToolLine.
 */
export function formatActivity(ev: StreamEvent): string | null {
	switch (ev.type) {
		case "compaction":
			return `  ${ui.yellow(sym.diamond)} ${ui.bold("compacted")} ${ui.dim(`${ev.tokensBefore} → ${ev.tokensAfter} tokens`)}`;
		case "error":
			return `  ${ui.red(sym.cross)} ${ui.bold("error")} ${ui.dim(`[${ev.errorType}]`)} ${ev.message}`;
		default:
			return null;
	}
}

// Thinking blocks share the answer-block geometry (indent + wrap width) so
// they line up visually with the rendered answer, but are rendered dim and
// prefixed with a label so they are clearly distinguishable as reasoning.
const THINKING_LABEL_INDENT = "  ";
const THINKING_BODY_INDENT = "    ";

/**
 * Render a complete thinking (or thinking_summary) block as dim, wrapped text
 * on stderr. The block is prefixed with a dim diamond + label so it reads as
 * an "aside" from the model's reasoning rather than part of the answer.
 */
export function formatThinkingBlock(text: string, label = "thinking"): string {
	const trimmed = text.trim();
	if (!trimmed) return "";
	const cols = process.stdout.columns ?? 100;
	const width = Math.max(
		ANSWER_MIN_WIDTH,
		Math.min(ANSWER_MAX_WIDTH, cols - THINKING_BODY_INDENT.length * 2),
	);
	const wrapped = trimmed.split("\n").flatMap((line) => wrapAnsiLine(line, width));
	const header = `${THINKING_LABEL_INDENT}${ui.dim(sym.diamond)} ${ui.dim(ui.bold(label))}`;
	const body = wrapped.map((l) => `${THINKING_BODY_INDENT}${ui.dim(l)}`).join("\n");
	return `${header}\n${body}`;
}

/**
 * End-of-turn summary. The plain-text form is kept stable (substrings like
 * `N iter`, `X.Xs`, `in=…k`, `out=…k`, `provider/model`) so it remains
 * grep-able and matches the documented shape in tests. Stats and model are
 * split across two lines so the summary never mid-wraps on narrow terminals.
 */
export function formatSummary(usage: TokenUsage, metadata: TurnMetadata, ok = true): string {
	const seconds = (metadata.latencyMs / 1000).toFixed(1);
	const inK = (usage.inputTokens / 1000).toFixed(1);
	const outK = (usage.outputTokens / 1000).toFixed(1);
	const cacheNote =
		usage.cacheReadTokens > 0 ? ` cache_read=${(usage.cacheReadTokens / 1000).toFixed(1)}k` : "";
	const mark = ok ? ui.green(sym.check) : ui.red(sym.cross);
	const stats = ui.dim(
		`${metadata.iterations} iter · ${seconds}s · in=${inK}k out=${outK}k${cacheNote}`,
	);
	const model = ui.dim(`${metadata.model.provider}/${metadata.model.id}`);
	return `  ${mark} ${stats}\n    ${model}`;
}

function summarizeParams(params: Record<string, unknown>): string {
	const keys = Object.keys(params);
	if (keys.length === 0) return "";
	const first = keys[0]!;
	const v = params[first];
	const sv = typeof v === "string" ? `"${v.length > 40 ? `${v.slice(0, 40)}…` : v}"` : String(v);
	return keys.length === 1 ? `${first}=${sv}` : `${first}=${sv}, …`;
}
