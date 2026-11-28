// Generated rows with more than one `**`, and `partial` under `**`, checked
// against a reference matcher and the oracle. The fixed rows minimatch 10.2.x
// got wrong are in `globstar.test.ts`.

import { assert, describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Arbitrary, Effect, Schema } from "effect";
import type { MinimatchOptions } from "minimatch";
import { minimatch as oracle } from "minimatch";
import type { EngineOptions } from "../src/internal/minimatch.js";
import { Minimatch } from "../src/internal/minimatch.js";

const engine = (pattern: string, candidate: string, options?: EngineOptions): boolean =>
	new Minimatch(pattern, { platform: "posix", ...options }).match(candidate);

const oracleSays = (pattern: string, candidate: string, options?: EngineOptions): boolean =>
	oracle(candidate, pattern, { ...options, platform: "linux" } as MinimatchOptions);

// A second reference for this class, beside the oracle. It states the
// semantics in one place: a ** walks zero or more portions that are not . or ..
// and, without dot, do not start with a dot; a final ** walks at least one; a
// trailing "" may be dropped when the row ends in a portion; and under partial,
// running out of path matches. Rows here hold only literals and **.
const reference = (row: ReadonlyArray<string>, candidate: string, dot: boolean, partial: boolean): boolean => {
	const walkable = (f: string) => f !== "." && f !== ".." && (dot || !f.startsWith("."));
	const run = (parts: ReadonlyArray<string>): boolean => {
		const memo = new Map<number, boolean>();
		const go = (i: number, j: number, walked: boolean): boolean => {
			const key = (i * (row.length + 1) + j) * 2 + (walked ? 1 : 0);
			const seen = memo.get(key);
			if (seen !== undefined) return seen;
			let out: boolean;
			if (partial && i >= parts.length) out = true;
			else if (j === row.length) out = i === parts.length || (partial && i === parts.length - 1 && parts[i] === "");
			else if (row[j] === "**") {
				const canStop = j < row.length - 1 || walked || partial;
				out =
					(canStop && go(i, j + 1, false)) || (i < parts.length && walkable(parts[i] as string) && go(i + 1, j, true));
			} else out = i < parts.length && row[j] === parts[i] && go(i + 1, j + 1, false);
			memo.set(key, out);
			return out;
		};
		return go(0, 0, false);
	};
	const parts = candidate.split("/");
	if (run(parts)) return true;
	return !partial && parts.at(-1) === "" && parts.length > 1 && row.at(-1) !== "**" && run(parts.slice(0, -1));
};

const portions = (min: number, max: number, of: ReadonlyArray<string>) =>
	Schema.Array(Schema.Literals(of as [string, ...Array<string>])).check(Schema.isBetweenLength(min, max));

const rowArb = Arbitrary.schema(
	Schema.Tuple([
		portions(0, 2, ["a", "b", ".c"]),
		portions(1, 4, ["a", "b", ".c"]),
		portions(0, 3, ["a", "b", ".c", "**"]),
		portions(0, 2, ["a", "b", ".c"]),
	]),
).pipe(Arbitrary.map(([head, mid, more, tail]) => [...head, "**", ...mid, "**", ...more, ...tail]));

const pathArb = Arbitrary.schema(
	Schema.Tuple([
		Schema.Array(Schema.Literals(["a", "b", ".c", "x", ".", ".."])).check(Schema.isBetweenLength(1, 12)),
		Schema.Boolean,
	]),
).pipe(Arbitrary.map(([parts, slash]) => `${parts.join("/")}${slash ? "/" : ""}`));

describe("more than one globstar: reference properties", () => {
	it.effect.prop(
		"agrees with the reference matcher",
		[rowArb, pathArb, Arbitrary.schema(Schema.Boolean), Arbitrary.schema(Schema.Boolean)],
		([row, candidate, dot, partial]) =>
			Effect.sync(() => {
				const answer = engine(row.join("/"), candidate, { dot, partial });
				const label = `${row.join("/")} vs ${candidate} dot=${dot} partial=${partial}`;
				assert.strictEqual(answer, reference(row, candidate, dot, partial), label);
				assert.strictEqual(answer, oracleSays(row.join("/"), candidate, { dot, partial }), `oracle: ${label}`);
			}),
		{ arbitrary: { runs: Depth.pick({ sample: 2_000, full: 20_000 }) } },
	);
});
