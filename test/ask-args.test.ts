import { describe, expect, it } from "vitest";
import { ArgParseError, parseAskArgs } from "../src/cli/ask-args.ts";

describe("parseAskArgs", () => {
	it("parses positional repo and question", () => {
		const a = parseAskArgs(["https://github.com/o/r", "What is this?"]);
		expect(a.repo).toBe("https://github.com/o/r");
		expect(a.question).toBe("What is this?");
		expect(a.responseOnly).toBe(false);
		expect(a.json).toBe(false);
	});

	it("joins extra positional words into the question", () => {
		const a = parseAskArgs(["https://github.com/o/r", "What", "frameworks?"]);
		expect(a.question).toBe("What frameworks?");
	});

	it("parses repo, model, and thinking flags", () => {
		const a = parseAskArgs([
			"https://github.com/o/r",
			"q",
			"--token",
			"tok",
			"--commitish",
			"main",
			"--provider",
			"anthropic",
			"--model",
			"claude-sonnet-4-6",
			"--max-iterations",
			"30",
			"--thinking",
			"adaptive",
			"--thinking-effort",
			"high",
		]);
		expect(a.token).toBe("tok");
		expect(a.commitish).toBe("main");
		expect(a.provider).toBe("anthropic");
		expect(a.model).toBe("claude-sonnet-4-6");
		expect(a.maxIterations).toBe(30);
		expect(a.thinking).toBe("adaptive");
		expect(a.thinkingEffort).toBe("high");
	});

	it("supports --flag=value form", () => {
		const a = parseAskArgs(["repo", "q", "--model=claude-sonnet-4-6", "--response-only"]);
		expect(a.model).toBe("claude-sonnet-4-6");
		expect(a.responseOnly).toBe(true);
	});

	it("rejects unknown flags", () => {
		expect(() => parseAskArgs(["repo", "q", "--nope"])).toThrow(ArgParseError);
	});

	it("rejects --thinking values other than adaptive", () => {
		expect(() => parseAskArgs(["repo", "q", "--thinking", "off"])).toThrow(/adaptive/);
	});

	it("rejects invalid --thinking-effort values", () => {
		expect(() => parseAskArgs(["repo", "q", "--thinking-effort", "extreme"])).toThrow(
			/low\|medium\|high/,
		);
	});

	it("rejects non-positive --max-iterations", () => {
		expect(() => parseAskArgs(["repo", "q", "--max-iterations", "0"])).toThrow(/positive integer/);
	});

	it("captures --help", () => {
		expect(parseAskArgs(["--help"]).help).toBe(true);
		expect(parseAskArgs(["-h"]).help).toBe(true);
	});
});
