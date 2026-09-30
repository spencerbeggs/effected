import { assert, describe, it } from "@effect/vitest";
import type { AudienceKind } from "@effected/env";
import { Audience } from "@effected/env";
import { Console, Effect, References } from "effect";
import { CliMessage, CliTheme, Status, Token } from "../src/index.js";

/** A `Console` recording which stream each line went to, in one sequence. */
const capturing = () => {
	const out: string[] = [];
	const err: string[] = [];
	const console_: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { console: console_, out, err };
};

const run = (
	program: Effect.Effect<void, never, CliTheme | Audience>,
	options: {
		readonly audience?: AudienceKind;
		readonly color?: "none" | "basic" | "truecolor";
		readonly glyphs?: "unicode" | "ascii";
	} = {},
) =>
	Effect.gen(function* () {
		const { console: double, out, err } = capturing();
		yield* program.pipe(
			Effect.provide(CliTheme.layerTest({ color: options.color ?? "none", glyphs: options.glyphs ?? "unicode" })),
			Effect.provide(Audience.layerTest(options.audience ?? "human")),
			Effect.provideService(Console.Console, double),
		);
		return { out, err };
	});

describe("CliMessage streams", () => {
	it.effect("success and info go to stdout, warning and failure to stderr", () =>
		Effect.gen(function* () {
			const { out, err } = yield* run(
				Effect.gen(function* () {
					yield* CliMessage.success("done");
					yield* CliMessage.info("fyi");
					yield* CliMessage.warning("careful");
					yield* CliMessage.failure("boom");
				}),
			);
			assert.deepStrictEqual(out, ["✓ done", "ℹ fyi"]);
			assert.deepStrictEqual(err, ["⚠ careful", "✗ boom"]);
		}),
	);

	it.effect("status defaults to stderr for a rank at or above warning's, so a custom status follows its rank", () =>
		Effect.gen(function* () {
			const vocab = Status.extend({
				timeout: { glyph: "⧖", ascii: "[time]", token: Token.hex("#e09a4e"), rank: 85 },
				note: { glyph: "·", ascii: "[note]", token: "muted", rank: 50 },
			});
			const { out, err } = yield* run(
				Effect.gen(function* () {
					yield* CliMessage.status(vocab, "timeout", "slow");
					yield* CliMessage.status(vocab, "note", "fyi");
					yield* CliMessage.status(vocab, "skip", "skipped");
				}),
			);
			assert.deepStrictEqual(err, ["⧖ slow"]);
			assert.deepStrictEqual(out, ["· fyi", "↷ skipped"]);
		}),
	);

	it.effect("an explicit stream overrides the default", () =>
		Effect.gen(function* () {
			const { out, err } = yield* run(
				Effect.gen(function* () {
					yield* CliMessage.status(Status.core, "failure", "to stdout", { stream: "stdout" });
					yield* CliMessage.status(Status.core, "success", "to stderr", { stream: "stderr" });
				}),
			);
			assert.deepStrictEqual(out, ["✗ to stdout"]);
			assert.deepStrictEqual(err, ["✓ to stderr"]);
		}),
	);

	it.effect("uses the ASCII glyph when the theme's glyphs are ASCII", () =>
		Effect.gen(function* () {
			const { err } = yield* run(CliMessage.failure("boom"), { glyphs: "ascii" });
			assert.deepStrictEqual(err, ["[FAIL] boom"]);
		}),
	);
});

describe("CliMessage audience", () => {
	it.effect("a human with colour gets the glyph painted and the text plain", () =>
		Effect.gen(function* () {
			const { out, err } = yield* run(
				Effect.gen(function* () {
					yield* CliMessage.success("done");
					yield* CliMessage.failure("boom");
				}),
				{ audience: "human", color: "truecolor" },
			);
			assert.deepStrictEqual(out, ["\x1b[32m✓\x1b[39m done"]);
			assert.deepStrictEqual(err, ["\x1b[31m✗\x1b[39m boom"]);
		}),
	);

	for (const audience of ["agent"] as const) {
		it.effect(`${audience}: glyph and text, never coloured, even when the theme has colour`, () =>
			Effect.gen(function* () {
				const { out, err } = yield* run(
					Effect.gen(function* () {
						yield* CliMessage.success("done");
						yield* CliMessage.warning("careful");
						yield* CliMessage.failure("boom");
					}),
					{ audience, color: "truecolor" },
				);
				assert.deepStrictEqual(out, ["✓ done"]);
				assert.deepStrictEqual(err, ["⚠ careful", "✗ boom"]);
				for (const line of [...out, ...err]) assert.notInclude(line, "\x1b");
			}),
		);
	}

	it.effect("an agent with an ASCII theme gets the ASCII glyph, uncoloured", () =>
		Effect.gen(function* () {
			const { err } = yield* run(CliMessage.failure("boom"), { audience: "agent", color: "basic", glyphs: "ascii" });
			assert.deepStrictEqual(err, ["[FAIL] boom"]);
		}),
	);

	it.effect("a ci audience is themed like a human (only agent is forced plain)", () =>
		Effect.gen(function* () {
			const { out } = yield* run(CliMessage.success("done"), { audience: "ci", color: "basic" });
			assert.deepStrictEqual(out, ["\x1b[32m✓\x1b[39m done"]);
		}),
	);
});

describe("CliMessage and the logger", () => {
	it.effect("lines still print when the minimum log level is None: they go through Console, not the logger", () =>
		Effect.gen(function* () {
			const { out, err } = yield* run(
				Effect.gen(function* () {
					yield* CliMessage.success("done");
					yield* CliMessage.failure("boom");
				}).pipe(Effect.provideService(References.MinimumLogLevel, "None")),
			);
			assert.deepStrictEqual(out, ["✓ done"]);
			assert.deepStrictEqual(err, ["✗ boom"]);
		}),
	);
});

describe("CliMessage edge cases", () => {
	it.effect("empty text prints the glyph alone, with no trailing space", () =>
		Effect.gen(function* () {
			const human = yield* run(CliMessage.success(""));
			assert.deepStrictEqual(human.out, ["✓"]);
			const agent = yield* run(CliMessage.failure(""), { audience: "agent" });
			assert.deepStrictEqual(agent.err, ["✗"]);
		}),
	);

	it.effect("an agent audience honours an explicit stream override, still plain", () =>
		Effect.gen(function* () {
			const { out, err } = yield* run(
				Effect.gen(function* () {
					yield* CliMessage.status(Status.core, "failure", "to stdout", { stream: "stdout" });
					yield* CliMessage.status(Status.core, "success", "to stderr", { stream: "stderr" });
				}),
				{ audience: "agent", color: "truecolor" },
			);
			assert.deepStrictEqual(out, ["✗ to stdout"]);
			assert.deepStrictEqual(err, ["✓ to stderr"]);
		}),
	);

	it.effect("replacing the core warning with a low rank moves the stderr threshold for that vocabulary", () =>
		Effect.gen(function* () {
			const vocab = Status.extend({ warning: { glyph: "!", ascii: "!", token: "warning", rank: 5 } });
			const { out, err } = yield* run(
				Effect.gen(function* () {
					yield* CliMessage.status(vocab, "warning", "low");
					yield* CliMessage.status(vocab, "success", "above the new threshold");
				}),
			);
			// success (10) is now at or above warning's rank (5), so it goes to stderr with it.
			assert.deepStrictEqual(err, ["! low", "✓ above the new threshold"]);
			assert.deepStrictEqual(out, []);
		}),
	);
});
