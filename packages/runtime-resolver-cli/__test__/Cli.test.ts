import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer } from "effect";
import { TestClock, TestConsole } from "effect/testing";
import { Command } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import type { CliResponse } from "../src/index.js";
import { command, serializeError } from "../src/index.js";

/**
 * A `fetch` that always fails, so every run resolves from the bundled snapshot
 * and the suite never touches the network. The offline flag covers the same
 * ground for Node; this covers Bun and Deno, whose GitHub calls would otherwise
 * be attempted.
 */
const deadNetwork = Layer.succeed(FetchHttpClient.Fetch)(async () => {
	throw new Error("network disabled in tests");
});

/**
 * `Command.run` needs `Command.Environment` — FileSystem, Path, Terminal, Stdio
 * and ChildProcessSpawner. `effect` core declares all five and implements none
 * of them for Node, which is precisely why this package is integrated tier and
 * the library it wraps is not.
 *
 * `Console.log` is unaffected: it goes through core's `Console`, which
 * `it.effect` has already overridden with `TestConsole`.
 */
const environment = Layer.mergeAll(NodeServices.layer, deadNetwork);

/**
 * A date inside the bundled snapshot's coverage.
 *
 * `it.effect` installs a virtual clock that starts at the epoch, so a CLI run
 * that reads `DateTime.now` would evaluate Node's lifecycle phases in 1970 —
 * before every release exists, so nothing matches and every run fails. Pinning
 * the clock also keeps the suite from rotting as the wall clock advances past
 * the snapshot's schedule.
 */
const NOW = new Date("2026-01-15T00:00:00Z").getTime();

/**
 * Run the CLI with an explicit argument vector and return the line it printed.
 *
 * `Command.runWith` is what makes this possible: the v3 CLI could only be
 * exercised by spawning a process, so its handler was almost entirely untested.
 *
 * `TestConsole.logLines` accumulates for the whole test, so this returns only
 * the lines this invocation added — otherwise a test that runs the CLI twice
 * silently asserts against the first run's output both times.
 */
const run = (argv: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		yield* TestClock.setTime(NOW);
		const before = (yield* TestConsole.logLines).length;
		yield* Command.runWith(command, { version: "0.0.0-test" })([...argv]);
		const lines = yield* TestConsole.logLines;
		return lines.slice(before);
	}).pipe(Effect.provide(environment));

/**
 * Run the CLI and keep BOTH channels.
 *
 * `run` would swallow the stdout of an invocation that fails, and a usage error
 * has to be observed as a failure — an assertion on stdout alone cannot tell a
 * command that failed cleanly from one that printed nothing and exited 0.
 */
const runExit = (argv: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		yield* TestClock.setTime(NOW);
		const before = (yield* TestConsole.logLines).length;
		const exit = yield* Effect.exit(Command.runWith(command, { version: "0.0.0-test" })([...argv]));
		const lines = (yield* TestConsole.logLines).slice(before);
		return { exit, lines };
	}).pipe(Effect.provide(environment));

const parseOutput = (lines: ReadonlyArray<unknown>): CliResponse & { readonly $schema: string } =>
	JSON.parse(String(lines[0])) as CliResponse & { readonly $schema: string };

/**
 * The typed failure a run left behind, or `undefined` if it did not fail typed.
 *
 * Reading the `Fail` reason specifically is what distinguishes "failed through
 * the error channel" from "died" — a usage error that escaped as a defect would
 * also make `Exit.isFailure` true.
 */
const usageErrorOf = (exit: Exit.Exit<void, unknown>): { readonly _tag: string } | undefined => {
	if (!Exit.isFailure(exit)) return undefined;
	const fail = exit.cause.reasons.find(Cause.isFailReason);
	return fail?.error as { readonly _tag: string } | undefined;
};

describe("runtime-resolver CLI", () => {
	it.effect("resolves node and prints an ok envelope", () =>
		Effect.gen(function* () {
			const lines = yield* run(["--node", ">=20", "--offline"]);
			const response = parseOutput(lines);

			assert.isTrue(response.ok);
			assert.include(response.$schema, "runtime-resolver.schema.json");

			const node = response.results.node;
			assert.isTrue(node.ok);
			if (node.ok) {
				assert.strictEqual(node.source, "cache", "an offline run must report snapshot provenance");
				assert.isAbove(node.versions.length, 0);
			}
		}),
	);

	it.effect("resolves several runtimes in one invocation", () =>
		Effect.gen(function* () {
			const lines = yield* run(["--node", ">=20", "--bun", "^1.0.0", "--deno", "^2.0.0", "--offline"]);
			const response = parseOutput(lines);

			assert.isTrue(response.ok);
			assert.deepStrictEqual(Object.keys(response.results).sort(), ["bun", "deno", "node"]);
		}),
	);

	it.effect("a failing runtime does not suppress a succeeding one", () =>
		Effect.gen(function* () {
			// The node range matches nothing; bun's does. Both must be reported.
			const lines = yield* run(["--node", ">=999", "--bun", "^1.0.0", "--offline"]);
			const response = parseOutput(lines);

			assert.isFalse(response.ok, "ok is false when any runtime failed");
			assert.isFalse(response.results.node.ok);
			assert.isTrue(response.results.bun.ok, "bun still resolved");

			const failure = response.results.node;
			if (!failure.ok) {
				// The structured fields ARE the message — v3 emitted prose here.
				assert.strictEqual(failure.error._tag, "NoMatchingVersionError");
				assert.strictEqual(failure.error.constraint, ">=999");
				assert.strictEqual(failure.error.runtime, "node");
			}
		}),
	);

	it.effect("an invalid range is reported as a range error, not a not-found", () =>
		Effect.gen(function* () {
			const lines = yield* run(["--node", "not a range", "--offline"]);
			const response = parseOutput(lines);

			assert.isFalse(response.ok);
			const failure = response.results.node;
			if (!failure.ok) {
				assert.strictEqual(failure.error._tag, "InvalidRangeError");
			}
		}),
	);

	it.effect("honours the increments flag", () =>
		Effect.gen(function* () {
			const latest = parseOutput(yield* run(["--node", "^20", "--node-phases", "maintenance-lts", "--offline"]));
			const patch = parseOutput(
				yield* run(["--node", "^20", "--node-phases", "maintenance-lts", "--increments", "patch", "--offline"]),
			);

			const latestNode = latest.results.node;
			const patchNode = patch.results.node;
			assert.isTrue(latestNode.ok && patchNode.ok);
			if (latestNode.ok && patchNode.ok) {
				assert.isAbove(patchNode.versions.length, latestNode.versions.length);
			}
		}),
	);

	it.effect("rejects an unknown lifecycle phase instead of silently using the defaults", () =>
		Effect.gen(function* () {
			const { exit, lines } = yield* runExit(["--node", ">=20", "--node-phases", "nonsense", "--offline"]);

			// Nothing is printed to stdout: the run stops rather than resolving with
			// phases the user never asked for.
			assert.lengthOf(lines, 0);

			// And it FAILS. Printing a complaint and exiting 0 is how a CI job gating on
			// the exit status reads a typo as a pass.
			assert.isTrue(Exit.isFailure(exit));
			assert.strictEqual(usageErrorOf(exit)?._tag, "UserError", "and it fails typed, not as a defect");
		}),
	);

	it.effect("exits non-zero when no runtime is requested", () =>
		Effect.gen(function* () {
			const { exit, lines } = yield* runExit(["--offline"]);
			assert.lengthOf(lines, 0, "the guidance goes to stderr, not the JSON channel");
			assert.isTrue(Exit.isFailure(exit), "a bad invocation must not exit 0");
		}),
	);

	it.effect("a resolution failure is still reported in the envelope, not as a usage error", () =>
		Effect.gen(function* () {
			// The other side of the seam: making usage errors fail must not turn an
			// ordinary "nothing matched" into a failed run — that is data, and it belongs
			// in the JSON envelope with ok:false.
			const { exit, lines } = yield* runExit(["--node", ">=999", "--offline"]);
			assert.isTrue(Exit.isSuccess(exit));
			assert.isFalse(parseOutput(lines).ok);
		}),
	);

	it.effect("--schema prints a JSON Schema derived from the response schema", () =>
		Effect.gen(function* () {
			const lines = yield* run(["--schema"]);
			const document = JSON.parse(String(lines[0])) as Record<string, unknown>;
			// Derived from the same schema the writer uses, so the published schema
			// cannot drift from the payload the way a hand-maintained one does.
			assert.isDefined(document.schema);
			assert.isDefined(document.definitions);
		}),
	);

	it.effect("--pretty indents the output", () =>
		Effect.gen(function* () {
			const compact = yield* run(["--node", ">=20", "--offline"]);
			const pretty = yield* run(["--node", ">=20", "--offline", "--pretty"]);
			assert.notInclude(String(compact[0]), "\n");
			assert.include(String(pretty[0]), "\n");
		}),
	);
});

describe("serializeError", () => {
	it("keeps the tag and the structured fields, and drops the plumbing", () => {
		const detail = serializeError({
			_tag: "RateLimitError",
			retryAfter: 42,
			limit: 60,
			remaining: 0,
			message: "should not survive",
			stack: "should not survive",
			cause: new Error("not JSON-able"),
		});

		assert.deepStrictEqual(detail, { _tag: "RateLimitError", retryAfter: 42, limit: 60, remaining: 0 });
	});

	it("labels a non-error throwable rather than losing it", () => {
		assert.deepStrictEqual(serializeError("boom"), { _tag: "UnknownError", detail: "boom" });
	});
});
