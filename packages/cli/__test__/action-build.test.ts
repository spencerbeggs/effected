// `effected action build` as `bin.ts` runs it, under `CliRuntime.main`, over real temporary directories because rolldown
// bundles on the real disk.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { assert, describe, it } from "@effect/vitest";
import { Cause, ConfigProvider, Effect, Exit, Fiber, Layer, Runtime } from "effect";
import { TestConsole } from "effect/testing";
import { run } from "../src/main.js";
import { environment } from "./schema/harness.js";

const GOOD: Readonly<Record<string, string>> = {
	"package.json": JSON.stringify({ name: "action", version: "1.0.0" }),
	"effected.toml": '[action.entries]\nmain = "src/main.ts"\n',
	"action.yml":
		"name: test\ndescription: d\nruns:\n  using: node24\n  main: dist/main.js\nbranding:\n  icon: zap\n  color: blue\n",
	"src/main.ts": 'console.log("main");\n',
};

const Live = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const cli = (
	args: ReadonlyArray<string>,
	files: Readonly<Record<string, string | null>> = GOOD,
	env: Readonly<Record<string, string>> = {},
	ci = false,
) =>
	Effect.acquireUseRelease(
		Effect.sync(() => {
			const cwd = mkdtempSync(join(tmpdir(), "effected-action-cli-"));
			for (const [name, source] of Object.entries(files)) {
				if (source === null) continue;
				mkdirSync(dirname(join(cwd, name)), { recursive: true });
				writeFileSync(join(cwd, name), source);
			}
			return cwd;
		}),
		(cwd) =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					run({}, { cwd, ci }, environment(["action", "build", ...args], Live)).pipe(
						Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...env } }))),
					),
				);
				const code = Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : 0;
				const outText = (yield* TestConsole.logLines).map(String).join("\n");
				const errText = (yield* TestConsole.errorLines).map(String).join("\n");
				return {
					code,
					cwd,
					outText,
					errText,
					out: outText === "" ? [] : outText.split("\n"),
					dist: readdirSafe(join(cwd, "dist")),
					local: readdirSafe(join(cwd, ".github/actions/local/dist")),
				};
			}),
		(cwd) => Effect.sync(() => rmSync(cwd, { recursive: true, force: true })),
	);

const readdirSafe = (path: string): ReadonlyArray<string> => {
	try {
		return readdirSync(path);
	} catch {
		return [];
	}
};

describe("effected action build", () => {
	it.effect("exits 0, prints one line per entry and the total, and persists", () =>
		Effect.gen(function* () {
			const { code, out, errText, dist, local } = yield* cli(["--human"]);
			assert.strictEqual(code, 0, errText);
			assert.match(out[0] ?? "", /^✓ main: \d+ B \(\d+ms\) → dist\/main\.js$/);
			assert.match(out.at(-1) ?? "", /^built 1 entries in \d+ms$/);
			assert.include(dist, "main.js");
			assert.include(local, "main.js");
		}),
	);

	it.effect("--no-persist leaves the local action directory alone", () =>
		Effect.gen(function* () {
			const { code, errText, dist, local } = yield* cli(["--human", "--no-persist"]);
			assert.strictEqual(code, 0, errText);
			assert.include(dist, "main.js");
			assert.deepStrictEqual(local, []);
		}),
	);

	it.effect("prints validation warnings first, as code: message", () =>
		Effect.gen(function* () {
			const { code, out, errText } = yield* cli(["--human", "--no-persist"], { ...GOOD, "action.yml": null });
			assert.strictEqual(code, 0, errText);
			assert.strictEqual(out[0], "ACTION_YML_MISSING: action.yml not found");
			assert.match(out[1] ?? "", /^✓ main:/);
		}),
	);

	it.effect("--no-validate skips validation", () =>
		Effect.gen(function* () {
			const { code, errText, outText } = yield* cli(["--human", "--no-validate", "--no-persist"], {
				...GOOD,
				"action.yml": "name: [unclosed\n",
			});
			assert.strictEqual(code, 0, errText);
			assert.notInclude(outText, "ACTION_YML");
		}),
	);

	it.effect("a validation error exits 1, printing it and saying how many", () =>
		Effect.gen(function* () {
			const { code, outText, errText, dist } = yield* cli(["--human"], { ...GOOD, "action.yml": "name: [unclosed\n" });
			assert.strictEqual(code, 1);
			assert.include(outText, "ACTION_YML_SYNTAX_ERROR:");
			assert.include(errText, "1 validation error");
			assert.deepStrictEqual(dist, []);
		}),
	);

	it.effect("an entry that does not load exits 1, with a cross and its first line of error", () =>
		Effect.gen(function* () {
			const { code, out, errText } = yield* cli(["--human"], {
				...GOOD,
				"src/main.ts": 'throw new TypeError("broken at load");\n',
			});
			assert.strictEqual(code, 1);
			assert.match(out[0] ?? "", /^✗ main does not load: TypeError: broken at load$/);
			assert.include(errText, "1 failed entry");
		}),
	);

	it.effect("shows a warning an entry carries under its line", () =>
		Effect.gen(function* () {
			const { code, out, errText } = yield* cli(["--human", "--no-persist"], {
				...GOOD,
				"src/main.ts": 'console.log(eval("1"));\n',
			});
			assert.strictEqual(code, 0, errText);
			assert.match(out[0] ?? "", /^✓ main:/);
			assert.include(out[1] ?? "", "eval");
		}),
	);

	it.effect("--format json writes one ActionRunResult document on stdout", () =>
		Effect.gen(function* () {
			const { code, outText, errText } = yield* cli(["--format", "json", "--no-persist"]);
			assert.strictEqual(code, 0, errText);
			const document = JSON.parse(outText) as {
				readonly verdict: string;
				readonly result: { readonly build: { readonly entries: ReadonlyArray<unknown> }; readonly persisted: boolean };
			};
			assert.strictEqual(document.verdict, "ok");
			assert.lengthOf(document.result.build.entries, 1);
			assert.isFalse(document.result.persisted);
		}),
	);

	it.effect("--format json still writes the document on a failed verdict, and exits 1", () =>
		Effect.gen(function* () {
			const { code, outText } = yield* cli(["--format", "json"], {
				...GOOD,
				"src/main.ts": 'throw new TypeError("broken at load");\n',
			});
			assert.strictEqual(code, 1);
			assert.strictEqual((JSON.parse(outText) as { readonly verdict: string }).verdict, "failed");
		}),
	);

	it.effect("no [action] table exits 2, saying so", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli([], { ...GOOD, "effected.toml": "" });
			assert.strictEqual(code, 2);
			assert.include(errText, "[action]");
		}),
	);

	it.effect("no package.json exits 2", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli([], { ...GOOD, "package.json": null });
			assert.strictEqual(code, 2);
			assert.include(errText, "not a package");
		}),
	);

	it.effect("a config with an unknown key exits 2 naming the key", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli([], { ...GOOD, "effected.toml": "[action.build]\nwhat = 1\n" });
			assert.strictEqual(code, 2);
			assert.include(errText, "action.build.what");
		}),
	);

	it.effect("what the builder cannot get past exits 3", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli(["--no-validate"], { ...GOOD, "src/main.ts": null });
			assert.strictEqual(code, 3);
			assert.include(errText, "Main entry point not found");
		}),
	);

	it.effect("a warning under CI is strict: exit 1, saying warnings are errors", () =>
		Effect.gen(function* () {
			const { code, outText, errText, dist } = yield* cli(["--human"], { ...GOOD, "action.yml": null }, {}, true);
			assert.strictEqual(code, 1);
			assert.include(outText, "ACTION_YML_MISSING");
			assert.include(errText, "warnings are errors in strict mode");
			assert.deepStrictEqual(dist, []);
		}),
	);

	it.effect("the same warning outside CI builds, so the test above is about ci", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli(["--human", "--no-persist"], { ...GOOD, "action.yml": null }, {}, false);
			assert.strictEqual(code, 0, errText);
		}),
	);

	it.effect("an unreadable package.json is the infrastructure tier: exit 3, through the command's own error", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli(["--human"], {
				...GOOD,
				"package.json": null,
				"package.json/not-a-file": "",
			});
			assert.strictEqual(code, 3);
			assert.include(errText, "ActionRunError");
			assert.include(errText, "package.json");
		}),
	);

	it.effect("an unknown flag is a usage error, exit 64", () =>
		Effect.gen(function* () {
			const { code } = yield* cli(["--no-such-flag"]);
			assert.strictEqual(code, 64);
		}),
	);

	it.effect("appends a step summary when the runner names a file", () =>
		Effect.gen(function* () {
			const summaryDir = mkdtempSync(join(tmpdir(), "effected-action-summary-"));
			const summary = join(summaryDir, "summary.md");
			writeFileSync(summary, "");
			const { code, errText } = yield* cli(["--human", "--no-persist"], GOOD, { GITHUB_STEP_SUMMARY: summary });
			assert.strictEqual(code, 0, errText);
			const text = readFileSync(summary, "utf8");
			rmSync(summaryDir, { recursive: true, force: true });
			assert.include(text, "### effected action build");
			assert.include(text, "dist/main.js");
		}),
	);
});

/** Writes `files` into a fresh temporary directory, removed when the scope closes. */
const tempAction = (files: Readonly<Record<string, string>>) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			const cwd = mkdtempSync(join(tmpdir(), "effected-action-watch-"));
			for (const [name, source] of Object.entries(files)) {
				mkdirSync(dirname(join(cwd, name)), { recursive: true });
				writeFileSync(join(cwd, name), source);
			}
			return cwd;
		}),
		(cwd) => Effect.sync(() => rmSync(cwd, { recursive: true, force: true })),
	);

const lines = (read: Effect.Effect<ReadonlyArray<unknown>>) =>
	Effect.map(read, (all) =>
		all
			.map(String)
			.join("\n")
			.split("\n")
			.filter((line) => line !== ""),
	);

/** Polls `check` every 50 ms of real time until it holds, for at most `seconds`. */
const eventually = (
	check: Effect.Effect<boolean>,
	what: string,
	seconds = 30,
	context: Effect.Effect<string> = Effect.succeed(""),
) =>
	Effect.gen(function* () {
		for (let waited = 0; waited < seconds * 20; waited++) {
			if (yield* check) return;
			yield* Effect.sleep("50 millis");
		}
		assert.fail(`timed out waiting for ${what}\n${yield* context}`);
	});

describe("effected action build --watch", () => {
	it.effect("--watch exits 2 without an [action] table", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli(["--watch"], { ...GOOD, "effected.toml": "" });
			assert.strictEqual(code, 2);
			assert.include(errText, "[action]");
		}),
	);

	it.effect("--watch is refused under CI", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli(["--watch"], GOOD, { CI: "true" }, true);
			assert.strictEqual(code, 64);
			assert.include(errText, "refused under CI");
		}),
	);

	it.live(
		"--watch rebuilds after src/main.ts changes",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const cwd = yield* tempAction(GOOD);
					const fiber = yield* run(
						{},
						{ cwd, ci: false },
						environment(["action", "build", "--watch", "--human"], Live),
					).pipe(
						Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
						Effect.forkChild({ startImmediately: true }),
					);
					const out = lines(TestConsole.logLines);
					const err = lines(TestConsole.errorLines);
					const reports = Effect.map(
						out,
						(all) => all.filter((line) => /^built 1 entries in \d+ms$/.test(line)).length,
					);
					const rebuilds = Effect.map(err, (all) => all.filter((line) => line.startsWith("rebuilding:")));
					const transcript = Effect.map(
						Effect.all([out, err]),
						([o, e]) => `stdout:\n${o.join("\n")}\nstderr:\n${e.join("\n")}`,
					);
					/** Polls until neither a report nor a rebuilding line has appeared for `quiet` ms of real time. */
					const quiescence = (quiet: number, bound: number) =>
						Effect.gen(function* () {
							let last = `${yield* reports}/${(yield* rebuilds).length}`;
							let still = 0;
							for (let waited = 0; waited < bound; waited += 50) {
								yield* Effect.sleep("50 millis");
								const now = `${yield* reports}/${(yield* rebuilds).length}`;
								still = now === last ? still + 50 : 0;
								last = now;
								if (still >= quiet) return;
							}
							assert.fail(`never went quiet\n${yield* transcript}`);
						});

					yield* eventually(
						Effect.map(reports, (n) => n >= 1),
						"the first report",
						20,
						transcript,
					);
					// Any late batch from the fixture's own creation lands here, before the rewrite, so it cannot hide in the
					// batch under test. It may name the fixture files; it must never be the build's own `.github` writes.
					yield* quiescence(1_000, 10_000);
					const before = yield* reports;
					const early = yield* rebuilds;
					for (const line of early) {
						const paths = line
							.slice("rebuilding: ".length)
							.replace(/ \+\d+ more$/, "")
							.split(", ");
						assert.isFalse(
							paths.every((path) => path === ".github" || path.startsWith(".github/")),
							`the build triggered itself: ${line}\n${yield* transcript}`,
						);
					}

					writeFileSync(join(cwd, "src/main.ts"), 'console.log("changed");\n');
					yield* eventually(
						Effect.map(reports, (n) => n === before + 1),
						"the report after the rewrite",
						10,
						transcript,
					);
					assert.strictEqual((yield* rebuilds).at(-1), "rebuilding: src/main.ts", yield* transcript);
					// A settle window well above the debounce: the rebuild's own writes must queue nothing.
					yield* Effect.sleep("1500 millis");
					assert.strictEqual(yield* reports, before + 1, `a surplus rebuild\n${yield* transcript}`);
					assert.strictEqual((yield* rebuilds).length, early.length + 1, yield* transcript);
					assert.isUndefined(fiber.pollUnsafe(), yield* transcript);
					assert.include(readFileSync(join(cwd, "dist/main.js"), "utf8"), "changed");
					yield* Fiber.interrupt(fiber);
				}).pipe(Effect.provide(TestConsole.layer)),
			),
		60_000,
	);
});
