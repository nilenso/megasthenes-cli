/**
 * Render helpers: extract the final assistant answer from a TurnResult and
 * render markdown for the terminal. Also formats the stderr summary line.
 */

import type { TokenUsage, TurnMetadata, TurnResult } from "@nilenso/megasthenes";
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";

const marked = new Marked(markedTerminal() as never);

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

export function renderMarkdown(text: string): string {
	if (!text) return "";
	try {
		const out = marked.parse(text);
		return typeof out === "string" ? out : text;
	} catch {
		return text;
	}
}

export function formatSummary(usage: TokenUsage, metadata: TurnMetadata): string {
	const seconds = (metadata.latencyMs / 1000).toFixed(1);
	const inK = (usage.inputTokens / 1000).toFixed(1);
	const outK = (usage.outputTokens / 1000).toFixed(1);
	const cacheNote =
		usage.cacheReadTokens > 0 ? ` cache_read=${(usage.cacheReadTokens / 1000).toFixed(1)}k` : "";
	return (
		`✓ ${metadata.iterations} iter · ${seconds}s · ` +
		`in=${inK}k out=${outK}k${cacheNote} · ` +
		`${metadata.model.provider}/${metadata.model.id}`
	);
}
