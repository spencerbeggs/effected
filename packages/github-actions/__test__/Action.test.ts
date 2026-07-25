import { assert, describe, it } from "@effect/vitest";
import { Cause, Config, Context, Effect, Layer, Schema } from "effect";
import { vi } from "vitest";
import { Action, ActionEnvironment, ActionInput, ActionRuntime, describeCause } from "../src/index.js";

class Extra extends Context.Service<Extra, { readonly describe: Effect.Effect<string, unknown> }>()("test/Extra") {}

class Boom extends Schema.TaggedErrorClass<Boom>()("Boom", { detail: Schema.String }) {
	override get message(): string {
		return `it went wrong: ${this.detail}`;
	}
}

/**
 * Run something with `console.log` captured and `process.exitCode` restored.
 *
 * @remarks
 * The exit code is the point of `Action.run`, and a test that failed to restore
 * it would fail the **vitest process** rather than the test — a green suite
 * whose exit code says otherwise.
 */
const RUNNER_ENV: Readonly<Record<string, string>> = {
	GITHUB_REPOSITORY: "acme/example",
	GITHUB_JOB: "test-job",
	// The runner uppercases an input name and replaces SPACES; dashes survive.
	"INPUT_MY-GREETING": "hello",
	// What the runner writes for an input the workflow did NOT supply.
	INPUT_OMITTED: "",
};

const captured = async (run: (lines: ReadonlyArray<string>) => Promise<void>): Promise<void> => {
	const lines: Array<string> = [];
	const spy = vi.spyOn(console, "log").mockImplementation((...parts: ReadonlyArray<unknown>) => {
		lines.push(parts.map(String).join(" "));
	});
	const previousExit = process.exitCode;
	const previousEnv = new Map(Object.keys(RUNNER_ENV).map((name) => [name, process.env[name]]));
	Object.assign(process.env, RUNNER_ENV);
	try {
		await run(lines);
	} finally {
		spy.mockRestore();
		// Restored on every path. `Action.run` sets `process.exitCode` by design,
		// and leaving it set would fail the VITEST process — a green suite whose
		// exit code says otherwise.
		process.exitCode = previousExit;
		for (const [name, value] of previousEnv) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
};

describe("describeCause", () => {
	it("renders a typed failure as [Tag]: message", () => {
		// What a human scanning a workflow log for the first red line actually
		// needs: which error, and what it said.
		assert.strictEqual(describeCause(Cause.fail(new Boom({ detail: "no token" }))), "[Boom]: it went wrong: no token");
	});

	it("marks a defect as one, because the two need different fixes", () => {
		const rendered = describeCause(Cause.die(new TypeError("x is not a function")));
		assert.include(rendered, "[defect]");
		assert.include(rendered, "x is not a function");
	});

	it("says something rather than nothing for an interruption", () => {
		// An interrupt carries no error and no message. The predecessor's fallback
		// chain ended in a sentinel for exactly this case; the requirement is only
		// that the line is never empty.
		assert.notStrictEqual(describeCause(Cause.interrupt(1)).trim(), "");
	});

	it("renders a plain Error, which is what a thrown library failure is", () => {
		assert.strictEqual(describeCause(Cause.fail(new RangeError("out of range"))), "[RangeError]: out of range");
	});
});

describe("Action.run", () => {
	it("resolves without touching the exit code when the program succeeds", async () => {
		await captured(async () => {
			await Action.run(Effect.void);
			assert.notStrictEqual(process.exitCode, 1);
		});
	});

	it("renders one ::error:: line and fails the step", async () => {
		await captured(async (lines) => {
			await Action.run(Effect.fail(new Boom({ detail: "no token" })));
			// The exit code is this function's job: `ActionOutputs.setFailed`
			// deliberately does not set it, so an action that reports a failure and
			// then recovers is not doomed by a side effect it cannot undo.
			assert.strictEqual(process.exitCode, 1);
			const errors = lines.filter((line) => line.startsWith("::error::"));
			assert.lengthOf(errors, 1, "one line, not a wall of them");
			assert.include(errors[0] ?? "", "Action failed: [Boom]: it went wrong: no token");
		});
	});

	it("puts the fiddly diagnostics behind ::debug::, where the runner hides them", async () => {
		await captured(async (lines) => {
			await Action.run(Effect.fail(new Boom({ detail: "no token" })));
			// A full cause render is genuinely useful and genuinely noisy. The
			// predecessor spliced a JS stack into the VISIBLE error, which in a
			// bundled action points at one line of `dist/main.js`.
			assert.isTrue(lines.some((line) => line.startsWith("::debug::")));
		});
	});

	it("fails the step for a defect too, not only for a typed failure", async () => {
		await captured(async (lines) => {
			await Action.run(
				Effect.sync((): void => {
					throw new TypeError("undefined is not a function");
				}),
			);
			assert.strictEqual(process.exitCode, 1);
			assert.isTrue(lines.some((line) => line.startsWith("::error::") && line.includes("[defect]")));
		});
	});

	it("never rejects, so an action entry point cannot produce an unhandled rejection", async () => {
		await captured(async () => {
			// Two failures — a failed step AND an unhandled rejection — and only the
			// first is legible in a workflow log.
			const settled = await Action.run(Effect.fail(new Boom({ detail: "x" }))).then(
				() => "resolved",
				() => "rejected",
			);
			assert.strictEqual(settled, "resolved");
		});
	});

	it("provides the runner services the program asks for", async () => {
		await captured(async (lines) => {
			await Action.run(
				Effect.gen(function* () {
					const env = yield* ActionEnvironment;
					const repository = yield* env.get("GITHUB_REPOSITORY");
					yield* Effect.logWarning(`saw ${repository}`);
				}),
			);
			assert.notStrictEqual(process.exitCode, 1);
			// Rendered as a workflow COMMAND, not merely printed: the runtime
			// installs the `Logger` that maps `Effect.log*` from any `@effected`
			// package onto `::warning::`, and the default logger would print the same
			// words in a shape the runner does not annotate.
			assert.include(lines, "::warning::saw acme/example");
		});
	});

	it("installs the INPUT_ config provider, so an input resolves without anyone spelling the variable", async () => {
		await captured(async (lines) => {
			await Action.run(
				Effect.gen(function* () {
					const greeting = yield* ActionInput.string("my-greeting");
					yield* Effect.log(`greeting=${greeting}`);
				}),
			);
			// `INPUT_MY-GREETING`, not `INPUT_MY_GREETING`: the runner uppercases and
			// replaces spaces, and leaves dashes alone. A consumer reading the wrong
			// spelling from `process.env` shipped that bug to production.
			assert.isTrue(lines.some((line) => line.includes("greeting=hello")));
			assert.notStrictEqual(process.exitCode, 1);
		});
	});

	it("reads an omitted input as absent, so a default is a default", async () => {
		await captured(async (lines) => {
			await Action.run(
				Effect.gen(function* () {
					const omitted = yield* ActionInput.string("omitted").pipe(Config.withDefault("fallback"));
					yield* Effect.logWarning(`omitted=${omitted}`);
				}),
			);
			// The runner writes `""` for every input a workflow left out, and an
			// empty string that read as PRESENT would make every optional input look
			// supplied and no default ever fire. Asserted end to end rather than
			// against `ActionInput.provider` in isolation, because the runtime
			// deliberately does not install that provider — this is the test that
			// fails if the semantics it relies on ever move.
			assert.include(lines, "::warning::omitted=fallback");
		});
	});

	it("wires an extra layer against the runtime's own services", async () => {
		await captured(async (lines) => {
			// The ergonomic claim: a layer whose requirements are satisfied by the
			// runtime — which is every heavy service in this package — costs the
			// caller one line and no wiring.
			const extra = Layer.effect(
				Extra,
				Effect.map(ActionEnvironment, (env) => ({ describe: env.get("GITHUB_JOB") })),
			);
			await Action.run(
				Effect.gen(function* () {
					const service = yield* Extra;
					yield* Effect.log(`job=${yield* service.describe}`);
				}),
				{ layer: extra },
			);
			assert.isTrue(lines.some((line) => line.includes("job=test-job")));
			assert.notStrictEqual(process.exitCode, 1);
		});
	});

	it("does not swallow the transcript of a run that then fails", async () => {
		await captured(async (lines) => {
			// The predecessor wrapped every program in a log buffer, and an unhandled
			// defect inside the buffer swallowed the whole transcript: the run failed
			// and printed nothing at all. Buffering is opt-in now.
			await Action.run(Effect.flatMap(Effect.log("halfway through"), () => Effect.fail(new Boom({ detail: "later" }))));
			assert.isTrue(lines.some((line) => line.includes("halfway through")));
			assert.isTrue(lines.some((line) => line.startsWith("::error::")));
			assert.strictEqual(process.exitCode, 1);
		});
	});

	it("exposes the runtime as a bound layer, not a factory", () => {
		// A layer-returning function mints a fresh layer per call and layers
		// memoize by reference, so a factory would re-read `process.env` at every
		// composition site.
		assert.strictEqual(ActionRuntime.layer, ActionRuntime.layer);
	});
});
