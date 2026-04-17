import { describe, expect, it } from "bun:test";
import type { Step, TurnResult } from "@nilenso/megasthenes";
import { extractFinalAnswer, formatSummary } from "../src/cli/ask-render.ts";

const turn = (steps: Step[]): TurnResult => ({
	id: "t1",
	prompt: "q",
	steps,
	usage: {
		inputTokens: 1000,
		outputTokens: 500,
		totalTokens: 1500,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	},
	metadata: {
		iterations: 1,
		latencyMs: 1234,
		model: { provider: "anthropic", id: "claude-sonnet-4-6" },
		repo: { url: "https://x", commitish: "abc" },
		config: { maxIterations: 25 },
	},
	error: null,
	startedAt: 0,
	endedAt: 1234,
});

describe("extractFinalAnswer", () => {
	it("returns assistant text when there are no tool calls", () => {
		const t = turn([
			{ type: "text", role: "assistant", text: "Hello." },
			{ type: "text", role: "assistant", text: "World." },
		]);
		expect(extractFinalAnswer(t)).toBe("Hello.\n\nWorld.");
	});

	it("returns only assistant text after the last tool call", () => {
		const t = turn([
			{ type: "text", role: "assistant", text: "Investigating…" },
			{
				type: "tool_call",
				id: "c1",
				name: "read_file",
				params: {},
				output: "x",
				isError: false,
				durationMs: 10,
			},
			{ type: "text", role: "assistant", text: "The answer is 42." },
		]);
		expect(extractFinalAnswer(t)).toBe("The answer is 42.");
	});

	it("returns empty string if the last step is a tool call", () => {
		const t = turn([
			{
				type: "tool_call",
				id: "c1",
				name: "x",
				params: {},
				output: "",
				isError: false,
				durationMs: 1,
			},
		]);
		expect(extractFinalAnswer(t)).toBe("");
	});
});

describe("formatSummary", () => {
	it("formats latency, tokens, and model identity", () => {
		const t = turn([]);
		const s = formatSummary(t.usage, t.metadata);
		expect(s).toContain("1 iter");
		expect(s).toContain("1.2s");
		expect(s).toContain("in=1.0k");
		expect(s).toContain("out=0.5k");
		expect(s).toContain("anthropic/claude-sonnet-4-6");
	});
});
