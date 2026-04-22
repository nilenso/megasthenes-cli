/**
 * TTY-aware output helpers for the CLI's stderr activity channel.
 *
 * We intentionally keep this tiny and dependency-free: ANSI escapes are only
 * emitted when stderr is an interactive TTY and the user hasn't disabled
 * colors via NO_COLOR / FORCE_COLOR=0. On non-TTY streams we emit plain text
 * suitable for logs and pipelines.
 *
 * The `StatusLine` primitive lets callers show a single-line live status
 * (spinner-style) on a TTY while still producing clean, append-only logs
 * when redirected — useful for clone-progress callbacks that fire the same
 * message repeatedly.
 */

const colorsEnabled = computeColorsEnabled();

function computeColorsEnabled(): boolean {
	// Reasoning: honor the widely-adopted NO_COLOR convention and the
	// FORCE_COLOR=0 escape hatch before falling back to TTY detection.
	if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
	if (process.env.FORCE_COLOR === "0") return false;
	if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "") return true;
	return process.stderr.isTTY === true;
}

const ESC = (code: string) => (colorsEnabled ? `\x1b[${code}m` : "");
const RESET = ESC("0");

const wrap =
	(code: string) =>
	(s: string): string =>
		colorsEnabled ? `${ESC(code)}${s}${RESET}` : s;

export const ui = {
	tty: process.stderr.isTTY === true,
	colors: colorsEnabled,
	dim: wrap("2"),
	bold: wrap("1"),
	red: wrap("31"),
	green: wrap("32"),
	yellow: wrap("33"),
	cyan: wrap("36"),
	gray: wrap("90"),
};

/** Symbols used throughout the CLI's activity output. */
export const sym = {
	bullet: "▸",
	check: "✓",
	cross: "✗",
	diamond: "◇",
};

/**
 * A "live" single-line status indicator on TTYs. On non-TTY streams it falls
 * back to appending distinct lines; consecutive duplicates are suppressed to
 * avoid log spam when the caller re-emits the same progress text.
 */
export class StatusLine {
	private lastText = "";
	private active = false;

	/** Update the live line (TTY) or append if changed (non-TTY). */
	update(text: string): void {
		if (process.stderr.isTTY === true) {
			process.stderr.write(`\r\x1b[2K${text}`);
			this.lastText = text;
			this.active = true;
			return;
		}
		if (text !== this.lastText) {
			process.stderr.write(`${text}\n`);
			this.lastText = text;
		}
	}

	/**
	 * Finalize the live line so subsequent output lands on a new line. If a
	 * `finalText` is provided it replaces the in-place line (TTY) or is
	 * appended if it differs from the last printed text (non-TTY).
	 */
	finalize(finalText?: string): void {
		if (process.stderr.isTTY === true) {
			if (!this.active && finalText === undefined) return;
			if (finalText !== undefined) process.stderr.write(`\r\x1b[2K${finalText}\n`);
			else process.stderr.write("\n");
		} else if (finalText !== undefined && finalText !== this.lastText) {
			process.stderr.write(`${finalText}\n`);
		}
		this.active = false;
		this.lastText = "";
	}

	/** Erase the live line (TTY only) without advancing the cursor. */
	clear(): void {
		if (process.stderr.isTTY === true && this.active) {
			process.stderr.write("\r\x1b[2K");
			this.active = false;
		}
	}
}

/**
 * Animated single-line status indicator for long-running work. On a TTY the
 * spinner frame advances on a timer and the caption can be updated mid-flight;
 * on non-TTY streams the spinner is silent so logs and pipes stay clean (the
 * final answer on stdout is still emitted).
 */
export class Spinner {
	private static readonly FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	private static readonly INTERVAL_MS = 80;

	private readonly isTTY = process.stderr.isTTY === true;
	private frameIdx = 0;
	private timer: NodeJS.Timeout | undefined;
	private caption = "";
	private active = false;

	/** Start spinning with the given caption. No-op on non-TTY streams. */
	start(caption: string): void {
		this.caption = caption;
		if (!this.isTTY) return;
		this.active = true;
		this.render();
		this.timer = setInterval(() => {
			this.frameIdx = (this.frameIdx + 1) % Spinner.FRAMES.length;
			this.render();
		}, Spinner.INTERVAL_MS);
	}

	/** Change the caption. Safe to call before start(); becomes initial caption. */
	update(caption: string): void {
		if (caption === this.caption) return;
		this.caption = caption;
		if (this.active) this.render();
	}

	/** Erase the live line and stop the timer. Idempotent. */
	stop(): void {
		if (this.timer !== undefined) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		if (this.active) {
			process.stderr.write("\r\x1b[2K");
			this.active = false;
		}
	}

	private render(): void {
		const frame = Spinner.FRAMES[this.frameIdx]!;
		process.stderr.write(`\r\x1b[2K  ${ui.cyan(frame)} ${this.caption}`);
	}
}
