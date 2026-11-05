/**
 * A pure line diff: Myers' shortest edit script over lines, grouped into
 * unified-diff hunks.
 *
 * @packageDocumentation
 */

/**
 * One line of a hunk.
 *
 * @public
 */
export interface LineDiffLine {
	readonly kind: "context" | "add" | "remove";
	readonly text: string;
	/** 1-based line in the old text; absent on an `add`. */
	readonly oldLine?: number;
	/** 1-based line in the new text; absent on a `remove`. */
	readonly newLine?: number;
}

/**
 * A run of changes with its surrounding context.
 *
 * @public
 */
export interface LineDiffHunk {
	readonly oldStart: number;
	readonly oldLines: number;
	readonly newStart: number;
	readonly newLines: number;
	readonly lines: ReadonlyArray<LineDiffLine>;
}

/**
 * Options for {@link LineDiff.compute}.
 *
 * @public
 */
export interface LineDiffOptions {
	/** Context lines around each change. Default 3. */
	readonly context?: number;
	/** Past this edit distance the middle becomes one remove-all, add-all block. Default 4096. */
	readonly maxEditDistance?: number;
}

interface Op {
	readonly kind: "context" | "add" | "remove";
	readonly text: string;
}

const splitLines = (text: string): ReadonlyArray<string> =>
	text === "" ? [] : (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");

/** Myers over two line arrays; `undefined` when the distance exceeds `max`. */
const myers = (a: ReadonlyArray<string>, b: ReadonlyArray<string>, max: number): ReadonlyArray<Op> | undefined => {
	const n = a.length;
	const m = b.length;
	const limit = Math.min(max, n + m);
	const offset = limit + 1;
	const v = new Int32Array(2 * limit + 3);
	const trace: Array<Int32Array> = [];
	let found = -1;
	for (let d = 0; d <= limit && found < 0; d++) {
		trace.push(v.slice(offset - d - 1, offset + d + 2));
		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))) x = v[offset + k + 1] ?? 0;
			else x = (v[offset + k - 1] ?? 0) + 1;
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x++;
				y++;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) {
				found = d;
				break;
			}
		}
	}
	if (found < 0) return undefined;
	const ops: Array<Op> = [];
	let x = n;
	let y = m;
	for (let d = found; d >= 0; d--) {
		const snap = trace[d] as Int32Array;
		const get = (k: number): number => snap[k + d + 1] ?? 0;
		const k = x - y;
		const prevK = k === -d || (k !== d && get(k - 1) < get(k + 1)) ? k + 1 : k - 1;
		const prevX = d === 0 ? 0 : get(prevK);
		const prevY = d === 0 ? 0 : prevX - prevK;
		while (x > prevX && y > prevY) {
			ops.push({ kind: "context", text: a[x - 1] as string });
			x--;
			y--;
		}
		if (d > 0) {
			if (x === prevX) ops.push({ kind: "add", text: b[prevY] as string });
			else ops.push({ kind: "remove", text: a[prevX] as string });
		}
		x = prevX;
		y = prevY;
	}
	return ops.reverse();
};

/**
 * Line diffs as plain values: no Effect, no JSON, no colour.
 *
 * Text is split on `\n`, one final `\n` terminating the last line rather than
 * starting another, so a missing final newline is not itself a difference. A
 * trailing `\r` stays in the line, so a CRLF difference is visible.
 *
 * @public
 */
export class LineDiff {
	private constructor() {}

	/** The hunks turning `before` into `after`; empty when they are equal. */
	static compute(before: string, after: string, options?: LineDiffOptions): ReadonlyArray<LineDiffHunk> {
		const context = Math.max(0, options?.context ?? 3);
		const maxEditDistance = options?.maxEditDistance ?? 4096;
		const a = splitLines(before);
		const b = splitLines(after);

		let prefix = 0;
		while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
		let suffix = 0;
		while (
			suffix < a.length - prefix &&
			suffix < b.length - prefix &&
			a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
		)
			suffix++;

		const midA = a.slice(prefix, a.length - suffix);
		const midB = b.slice(prefix, b.length - suffix);
		const middle: ReadonlyArray<Op> = myers(midA, midB, maxEditDistance) ?? [
			...midA.map((text): Op => ({ kind: "remove", text })),
			...midB.map((text): Op => ({ kind: "add", text })),
		];

		const ops: Array<Op> = [
			...a.slice(0, prefix).map((text): Op => ({ kind: "context", text })),
			...middle,
			...a.slice(a.length - suffix).map((text): Op => ({ kind: "context", text })),
		];

		const changed: Array<number> = [];
		for (let i = 0; i < ops.length; i++) if (ops[i]?.kind !== "context") changed.push(i);
		if (changed.length === 0) return [];

		// Cluster changes whose context windows touch or overlap.
		const ranges: Array<[number, number]> = [];
		for (const index of changed) {
			const last = ranges[ranges.length - 1];
			if (last !== undefined && index - context <= last[1]) last[1] = Math.min(ops.length, index + context + 1);
			else ranges.push([Math.max(0, index - context), Math.min(ops.length, index + context + 1)]);
		}

		// Running old/new line counts before each op.
		const oldBefore: Array<number> = [];
		const newBefore: Array<number> = [];
		let o = 0;
		let nw = 0;
		for (const op of ops) {
			oldBefore.push(o);
			newBefore.push(nw);
			if (op.kind !== "add") o++;
			if (op.kind !== "remove") nw++;
		}

		return ranges.map(([start, end]): LineDiffHunk => {
			const lines: Array<LineDiffLine> = [];
			let oldLines = 0;
			let newLines = 0;
			for (let i = start; i < end; i++) {
				const op = ops[i] as Op;
				const oldLine = oldBefore[i] as number;
				const newLine = newBefore[i] as number;
				if (op.kind === "add") {
					newLines++;
					lines.push({ kind: "add", text: op.text, newLine: newLine + 1 });
				} else if (op.kind === "remove") {
					oldLines++;
					lines.push({ kind: "remove", text: op.text, oldLine: oldLine + 1 });
				} else {
					oldLines++;
					newLines++;
					lines.push({ kind: "context", text: op.text, oldLine: oldLine + 1, newLine: newLine + 1 });
				}
			}
			const oldFirst = oldBefore[start] as number;
			const newFirst = newBefore[start] as number;
			return {
				oldStart: oldLines === 0 ? oldFirst : oldFirst + 1,
				oldLines,
				newStart: newLines === 0 ? newFirst : newFirst + 1,
				newLines,
				lines,
			};
		});
	}

	/** Git-style unified text for `hunks`; empty hunks give an empty string. */
	static unified(
		hunks: ReadonlyArray<LineDiffHunk>,
		labels: { readonly before: string; readonly after: string },
	): string {
		if (hunks.length === 0) return "";
		const out = [`--- ${labels.before}`, `+++ ${labels.after}`];
		for (const hunk of hunks) {
			out.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
			for (const line of hunk.lines) {
				out.push(`${line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}${line.text}`);
			}
		}
		return `${out.join("\n")}\n`;
	}
}
