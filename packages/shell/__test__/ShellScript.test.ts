// ShellScript.allCommands: every command at every depth of substitution, a
// typed truncation at the cap or the budget (never a silent drop), each
// distinct body parsed once, and a cost that stays linear in the input for a
// fixed cap on hostile nesting, fan-out and overlapping substitutions.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import type { ShellCommandWalk } from "../src/index.js";
import { ShellScript, ShellSyntax } from "../src/index.js";

const walk = (input: string, maxDepth?: number): ShellCommandWalk =>
	ShellSyntax.parse(input).allCommands(maxDepth === undefined ? undefined : { maxDepth });

const names = (result: ShellCommandWalk): ReadonlyArray<string | null> =>
	result.commands().map((command) => Option.getOrNull(command.name));

const chain = (depth: number, inner = "git commit"): string => `echo ${"$(".repeat(depth)}${inner}${")".repeat(depth)}`;

describe("ShellScript.allCommands", () => {
	it("walks every substitution body breadth first, in source order at each depth", () => {
		const result = walk("a $(b $(c)) $(d) && e");
		assert.deepStrictEqual(names(result), ["a", "e", "b", "d", "c"]);
		assert.deepStrictEqual(
			result.scripts.map((entry) => [entry.depth, Option.getOrNull(entry.parent), entry.script.source]),
			[
				[0, null, "a $(b $(c)) $(d) && e"],
				[1, 0, "b $(c)"],
				[1, 0, "d"],
				[2, 1, "c"],
			],
		);
		assert.isFalse(result.truncated);
		assert.strictEqual(result.maxDepth, ShellScript.defaultMaxDepth);
		assert.isTrue(Option.isNone(result.scripts[0]?.substitution ?? Option.some(0)));
		const script = ShellSyntax.parse("a $(b)");
		assert.strictEqual(script.allCommands().scripts[0]?.script, script);
	});

	it("reaches a command through every part kind that holds a substitution", () => {
		const shapes: ReadonlyArray<string> = [
			"echo $(c)",
			"echo `c`",
			"echo `echo \\`c\\``",
			"cat <(c)",
			"tee >(c)",
			'echo "$(c)"',
			`echo \${x:-$(c)}`,
			`echo "\${x:-$(c)}"`,
			"echo $(( $(c) + 1 ))",
			"(( x[$(c)] ))",
			"echo {a,$(c)}",
			"x=$(c)",
			"a[$(c)]=1",
			"x=($(c))",
			"echo > $(c)",
			"cat <<E\n$(c)\nE\n",
		];
		for (const input of shapes) assert.include(names(walk(input)), "c", input);
		// A quoted heredoc runs nothing, so there is nothing to walk.
		assert.notInclude(names(walk("cat <<'E'\n$(c)\nE\n")), "c");
	});

	it("records each substitution past the cap as a truncation, never drops it", () => {
		const capped = walk("echo $(echo $(git commit))", 1);
		assert.isTrue(capped.truncated);
		assert.notInclude(names(capped), "git");
		assert.deepStrictEqual(
			capped.truncations.map((t) => [t.reason, t.depth, t.parent, t.substitution.body]),
			[["depth", 2, 1, "git commit"]],
		);
		// Control: one level more and the body is parsed.
		const open = walk("echo $(echo $(git commit))", 2);
		assert.isFalse(open.truncated);
		assert.include(names(open), "git");
	});

	it("records every substitution at the cap, in source order", () => {
		const capped = walk("x $(a $(b) `c` <(d)) $(e)", 1);
		assert.deepStrictEqual(
			capped.truncations.map((t) => t.substitution.body),
			["b", "c", "d"],
		);
		assert.deepStrictEqual(names(capped), ["x", "a", "e"]);
	});

	it("maxDepth 0 parses no body and truncates every substitution", () => {
		const capped = walk("echo $(a) `b`", 0);
		assert.strictEqual(capped.scripts.length, 1);
		assert.deepStrictEqual(
			capped.truncations.map((t) => [t.depth, t.parent]),
			[
				[1, 0],
				[1, 0],
			],
		);
		assert.isFalse(walk("echo a", 0).truncated);
	});

	it("reads any maxDepth but a non-negative number as 0, rounds a fraction down and lets Infinity lift the cap", () => {
		const input = chain(3, "c");
		// A JavaScript or config-driven caller can pass what the type forbids;
		// each of these fails closed, truncating every substitution.
		const garbage: ReadonlyArray<unknown> = [-1, -0, Number.NaN, Number.NEGATIVE_INFINITY, 0.5, "abc", "3", 3n, {}];
		for (const maxDepth of garbage) {
			const result = ShellSyntax.parse(input).allCommands({ maxDepth: maxDepth as number });
			assert.isTrue(Object.is(result.maxDepth, 0), String(maxDepth));
			assert.strictEqual(result.scripts.length, 1, String(maxDepth));
			assert.deepStrictEqual(
				result.truncations.map((t) => [t.reason, t.depth]),
				[["depth", 1]],
				String(maxDepth),
			);
		}
		// `null`, like an absent maxDepth, is the default cap.
		assert.strictEqual(
			ShellSyntax.parse(input).allCommands({ maxDepth: null as unknown as number }).maxDepth,
			ShellScript.defaultMaxDepth,
		);
		assert.strictEqual(walk(input, 2.9).maxDepth, 2);
		assert.strictEqual(walk(input, 2.9).truncations[0]?.depth, 3);
		assert.isFalse(walk(input, Number.POSITIVE_INFINITY).truncated);
	});

	it("defaults to 16 levels", () => {
		assert.strictEqual(ShellScript.defaultMaxDepth, 16);
		assert.isFalse(walk(chain(16)).truncated);
		assert.include(names(walk(chain(16))), "git");
		const over = walk(chain(17));
		assert.isTrue(over.truncated);
		assert.deepStrictEqual(
			over.truncations.map((t) => [t.reason, t.depth, t.substitution.body]),
			[["depth", 17, "git commit"]],
		);
	});

	it("parses a substitution listed both by a script and inside another listed body once", () => {
		// Inside arithmetic, a subscript or `$[ … ]`, a `$((a) …)` falls back to a
		// command substitution and is listed with its own inner substitution,
		// so the two spans overlap. The inner one is reached twice: from the
		// top-level listing and from the outer body's parse.
		for (const [input, outer] of [
			["a[$((a) $(b))]=1", "(a) $(b)"],
			["echo $[ $((a) $(b))]", "(a) $(b)"],
			["echo $(( $((a) $(b))))", "(a) $(b)"],
		] as const) {
			const listed = ShellSyntax.parse(input)
				.substitutions()
				.map((part) => part.body);
			assert.deepStrictEqual(listed, [outer, "b"], input);
			const result = walk(input);
			assert.deepStrictEqual(
				result.scripts.map((entry) => entry.script.source),
				[input, outer, "b"],
				input,
			);
			assert.isFalse(result.truncated, input);
		}
	});

	it("keeps each nested script's own diagnostics", () => {
		// The backtick body is `echo $(x` after escape removal: unterminated
		// only once it is parsed.
		const result = walk("echo `echo \\$(x`");
		assert.deepStrictEqual(ShellSyntax.parse("echo `echo \\$(x`").diagnostics, []);
		assert.isAbove(result.scripts[1]?.script.diagnostics.length ?? 0, 0);
	});
});

/** The fastest of three CPU-time samples (`process.cpuUsage`) of a parse and walk. */
const cpu = (input: string, maxDepth?: number): number => {
	let best = Number.POSITIVE_INFINITY;
	for (let sample = 0; sample < 3; sample += 1) {
		const started = process.cpuUsage();
		walk(input, maxDepth);
		const used = process.cpuUsage(started);
		best = Math.min(best, (used.user + used.system) / 1000);
	}
	return best;
};

/**
 * The growth ratio of a walk from `build(size)` to `build(4 * size)`: linear
 * is near 4, quadratic near 16. The small side doubles until it takes 5 ms of
 * CPU, so it measures real work rather than timer noise.
 */
const growth = (build: (size: number) => string, start: number, maxDepth?: number): number => {
	let size = start;
	cpu(build(size), maxDepth); // warm up
	let small = cpu(build(size), maxDepth);
	while (small < 5 && size < start * 64) {
		size *= 2;
		small = cpu(build(size), maxDepth);
	}
	return cpu(build(size * 4), maxDepth) / Math.max(small, 5);
};

describe("ShellScript.allCommands on hostile input", () => {
	it("stays linear in the input over a deep $( chain at the default cap", () => {
		const ratio = growth((size) => chain(Math.floor(size / 2)), 16_384);
		assert.isBelow(ratio, 8);
	});

	it("stays linear in the input over a deep chain at a large cap", () => {
		const ratio = growth((size) => chain(Math.floor(size / 2)), 4096, 64);
		assert.isBelow(ratio, 8);
	});

	it("stays linear over thousands of substitutions in one command", () => {
		const ratio = growth((size) => `echo ${"$(a) ".repeat(Math.floor(size / 5))}`, 16_384);
		assert.isBelow(ratio, 8);
	});

	it("stays linear over fan-out at every depth", () => {
		const ratio = growth((size) => `echo ${"$(a $(b `c` <(d)) e) ".repeat(Math.floor(size / 26))}`, 16_384);
		assert.isBelow(ratio, 8);
	});

	it("returns a truncation for a megabyte of $( and never throws", { timeout: 60_000 }, () => {
		const result = walk(chain(1 << 19));
		assert.isTrue(result.truncated);
		assert.strictEqual(result.scripts.length, ShellScript.defaultMaxDepth + 1);
		assert.deepStrictEqual(
			result.truncations.map((t) => t.depth),
			[ShellScript.defaultMaxDepth + 1],
		);
	});

	it("walks a chain 4000 deep with no cap on a 200 KB stack: iterative, not recursive", () => {
		// A walk recursing once per depth throws a RangeError on this stack.
		const helper = fileURLToPath(new URL("./helpers/walk-chain.ts", import.meta.url));
		const child = spawnSync(process.execPath, ["--stack-size=200", "--import", "tsx", helper, "4000"], {
			encoding: "utf8",
			timeout: 60_000,
		});
		assert.strictEqual(child.status, 0, child.stderr);
		assert.strictEqual(child.stdout.trim(), "4001 false");
	});

	it("stops at the budget on overlapping substitutions, refusing a 6 KB gadget fast", () => {
		// Each level lists eight overlapping fallback substitutions over nearly
		// the whole remaining text; without the enforced budget the walk
		// re-parsed bodies exponentially in the cap and ran the heap out.
		const gadget = (levels: number, overlaps: number): string => {
			let g = "c";
			for (let i = 0; i < levels; i += 1) {
				g = `a[${"$((a) ".repeat(overlaps)}$(${g})${")".repeat(overlaps)}]=1`;
			}
			return g;
		};
		const input = `git commit -m x\n${`${gadget(16, 8)}\n`.repeat(6)}`;
		const started = process.cpuUsage();
		const result = walk(input);
		const used = process.cpuUsage(started);
		assert.isTrue(result.truncated);
		assert.deepStrictEqual(
			result.truncations.map((t) => t.reason),
			["budget"],
		);
		assert.isAtMost(lexed(result), ShellScript.defaultMaxDepth * input.length);
		assert.isBelow((used.user + used.system) / 1000, 1000);
		// The same gadget with a smaller cap stops on depth or budget, never
		// past the budget.
		for (const maxDepth of [0, 1, 4, 8, 64, Number.POSITIVE_INFINITY]) {
			const capped = walk(gadget(16, 8), maxDepth);
			assert.isAtMost(lexed(capped), Math.min(capped.maxDepth * gadget(16, 8).length, ShellScript.walkCharacterLimit));
		}
	});

	it("stops at the record limit, with one budget truncation", () => {
		assert.strictEqual(ShellScript.walkRecordLimit, 10_000);
		// Empty bodies cost no characters, so only the record limit stops them.
		const result = walk("$() ".repeat(ShellScript.walkRecordLimit));
		assert.strictEqual(result.scripts.length, ShellScript.walkRecordLimit);
		assert.deepStrictEqual(
			result.truncations.map((t) => [t.reason, t.depth]),
			[["budget", 1]],
		);
		assert.isFalse(walk("$() ".repeat(ShellScript.walkRecordLimit - 1)).truncated);
	});

	it("counts depth truncations against the record limit and ends with one budget truncation", () => {
		// 16 levels, then far more substitutions past the cap than the limit.
		const input = `${"$(".repeat(16)}${"$()".repeat(3 * ShellScript.walkRecordLimit)}${")".repeat(16)}`;
		const result = walk(input);
		assert.strictEqual(result.scripts.length + result.truncations.length, ShellScript.walkRecordLimit + 1);
		assert.strictEqual(result.truncations.filter((t) => t.reason === "budget").length, 1);
		assert.strictEqual(result.truncations.at(-1)?.reason, "budget");
		assert.isTrue(result.truncations.slice(0, -1).every((t) => t.reason === "depth" && t.depth === 17));
		// Control: under the limit every one is a depth truncation.
		const under = walk(`${"$(".repeat(16)}${"$()".repeat(100)}${")".repeat(16)}`);
		assert.deepStrictEqual([...new Set(under.truncations.map((t) => t.reason))], ["depth"]);
		assert.strictEqual(under.truncations.length, 100);
	});

	it("never throws and never lexes past its budget on random shell-dense input", () => {
		// mulberry32: a 32-bit PRNG whose state stays an exact integer.
		let state = 1266;
		const random = (): number => {
			state = (state + 0x6d2b79f5) | 0;
			let t = Math.imul(state ^ (state >>> 15), 1 | state);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		const TOKENS = [
			"$((a) ",
			"$(",
			")",
			"a[",
			"]=1",
			"$[",
			"]",
			"${x:-",
			"}",
			"`",
			"\\`",
			"<(",
			">(",
			'"',
			"'",
			"<<E\n",
			"\nE\n",
			"(( ",
			" ",
			"x",
			";",
		];
		for (let sample = 0; sample < 2000; sample += 1) {
			const length = 1 + Math.floor(random() * 60);
			let input = "";
			for (let i = 0; i < length; i += 1) input += TOKENS[Math.floor(random() * TOKENS.length)];
			for (const maxDepth of [0, 1, 3, 16, Number.POSITIVE_INFINITY]) {
				const result = walk(input, maxDepth);
				assert.isAtMost(lexed(result), Math.min(result.maxDepth * input.length, ShellScript.walkCharacterLimit), input);
				assert.isAtMost(result.scripts.length + result.truncations.length, ShellScript.walkRecordLimit + 1, input);
				// Every substitution the top-level script lists is parsed or
				// truncated, unless the walk stopped at its budget.
				if (result.truncations.some((t) => t.reason === "budget")) continue;
				const fromTop = new Set([
					...result.scripts.flatMap((entry) =>
						Option.getOrNull(entry.parent) === 0 ? Option.toArray(entry.substitution) : [],
					),
					...result.truncations.flatMap((t) => (t.parent === 0 ? [t.substitution] : [])),
				]);
				for (const part of ShellSyntax.parse(input).substitutions()) {
					assert.isTrue(
						[...fromTop].some((r) => r.start === part.start && r.end === part.end),
						input,
					);
				}
			}
		}
	});
});

/** The characters of substitution bodies a walk lexed. */
const lexed = (result: ShellCommandWalk): number =>
	result.scripts.slice(1).reduce((total, entry) => total + entry.script.source.length, 0);
