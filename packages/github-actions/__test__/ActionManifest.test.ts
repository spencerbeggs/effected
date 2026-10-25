import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Config, Effect, Result } from "effect";
import {
	ActionEnvironment,
	ActionInput,
	ActionManifest,
	ActionManifestCompositeRuns,
	ActionManifestDiff,
	ActionManifestDockerRuns,
	ActionManifestNodeRuns,
} from "../src/index.js";

/** A workflow expression, assembled so no template literal carries a placeholder-looking string. */
const TOKEN_EXPR = ["$", "{{ github.token }}"].join("");
const SUM_EXPR = ["$", "{{ steps.add.outputs.sum }}"].join("");

/** A realistic JavaScript-action manifest, shaped like the action template's. */
const NODE_MANIFEST = `name: Greeter
description: Greets people
author: Someone
branding:
  icon: package
  color: blue
inputs:
  # comments are fine
  name:
    description: Who to greet.
    required: false
    default: world
  guests:
    description: More people to greet.
    required: false
  emphatic:
    description: Exclamation mark (true | false).
    default: false
  retries:
    default: 3
  write-summary:
    description: Append a panel to the job summary.
    default: "true"
  token:
    description: The token.
    default: ${TOKEN_EXPR}
  old-flag:
    description: Gone.
    deprecationMessage: Use emphatic instead.
outputs:
  greeting:
    description: The rendered greeting.
  result:
    description: The structured run result, as JSON.
runs:
  using: node24
  main: dist/main.js
  pre: dist/pre.js
  post: dist/post.js
  pre-if: runner.os == 'Linux'
  post-if: always()
`;

const decoded = (source: string): ActionManifest => {
	const result = ActionManifest.decodeResult(source);
	if (Result.isFailure(result)) {
		throw new Error(result.failure.message);
	}
	return result.success;
};

describe("ActionManifest", () => {
	describe("decode", () => {
		it.effect("decodes a realistic node action manifest", () =>
			Effect.gen(function* () {
				const manifest = yield* ActionManifest.decode(NODE_MANIFEST);
				assert.strictEqual(manifest.name, "Greeter");
				assert.strictEqual(manifest.author, "Someone");
				assert.strictEqual(manifest.branding?.icon, "package");
				assert.strictEqual(manifest.branding?.color, "blue");
				assert.deepStrictEqual(Object.keys(manifest.inputs ?? {}), [
					"name",
					"guests",
					"emphatic",
					"retries",
					"write-summary",
					"token",
					"old-flag",
				]);
				const inputs = manifest.inputs ?? {};
				assert.strictEqual(inputs.name?.default, "world");
				assert.strictEqual(inputs.name?.required, false);
				assert.strictEqual(inputs.guests?.default, undefined);
				assert.strictEqual(inputs["old-flag"]?.deprecationMessage, "Use emphatic instead.");
				assert.deepStrictEqual(Object.keys(manifest.outputs ?? {}), ["greeting", "result"]);

				const runs = manifest.runs;
				assert.instanceOf(runs, ActionManifestNodeRuns);
				if (runs instanceof ActionManifestNodeRuns) {
					assert.strictEqual(runs.using, "node24");
					assert.strictEqual(runs.main, "dist/main.js");
					assert.strictEqual(runs.pre, "dist/pre.js");
					assert.strictEqual(runs.post, "dist/post.js");
					assert.strictEqual(runs.preIf, "runner.os == 'Linux'");
					assert.strictEqual(runs.postIf, "always()");
				}
			}),
		);

		it("stringifies unquoted YAML scalar defaults the way the runner publishes them", () => {
			const inputs = decoded(NODE_MANIFEST).inputs ?? {};
			assert.strictEqual(inputs.emphatic?.default, "false");
			assert.strictEqual(inputs.retries?.default, "3");
			assert.strictEqual(inputs["write-summary"]?.default, "true");
			// An expression default stays unevaluated text.
			assert.strictEqual(inputs.token?.default, TOKEN_EXPR);
		});

		it("decodes a composite action", () => {
			const manifest = decoded(`name: Composite
description: Runs steps
outputs:
  sum:
    description: The sum.
    value: ${SUM_EXPR}
runs:
  using: composite
  steps:
    - id: add
      run: echo "sum=3" >> "$GITHUB_OUTPUT"
      shell: bash
`);
			assert.instanceOf(manifest.runs, ActionManifestCompositeRuns);
			assert.strictEqual(manifest.outputs?.sum?.value, SUM_EXPR);
			assert.strictEqual(manifest.inputs, undefined);
		});

		it("decodes a docker action, renaming its hyphenated keys", () => {
			const manifest = decoded(`name: Docker
description: Runs a container
runs:
  using: docker
  image: Dockerfile
  args: ["--flag"]
  env:
    LEVEL: 2
  pre-entrypoint: /pre.sh
  post-entrypoint: /post.sh
  post-if: always()
`);
			const runs = manifest.runs;
			assert.instanceOf(runs, ActionManifestDockerRuns);
			if (runs instanceof ActionManifestDockerRuns) {
				assert.strictEqual(runs.image, "Dockerfile");
				assert.deepStrictEqual(runs.args, ["--flag"]);
				assert.deepStrictEqual(runs.env, { LEVEL: "2" });
				assert.strictEqual(runs.preEntrypoint, "/pre.sh");
				assert.strictEqual(runs.postEntrypoint, "/post.sh");
				assert.strictEqual(runs.postIf, "always()");
			}
		});

		it.effect("fails typed on text that is not YAML", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(ActionManifest.decode("name: [unclosed\n"));
				assert.strictEqual(error._tag, "ActionManifestDecodeError");
			}),
		);

		it.effect("fails typed on YAML that is not an action manifest", () =>
			Effect.gen(function* () {
				// No `main` for a node action.
				const error = yield* Effect.flip(ActionManifest.decode("name: Broken\nruns:\n  using: node24\n"));
				assert.strictEqual(error._tag, "ActionManifestDecodeError");
				assert.include(error.message, "Not a valid action manifest");
			}),
		);

		it("rejects a runs.using that names no known shape", () => {
			assert.isTrue(
				Result.isFailure(ActionManifest.decodeResult("name: X\nruns:\n  using: python3\n  main: main.py\n")),
			);
		});
	});

	describe("read", () => {
		it.effect("reads and decodes through FileSystem", () =>
			Effect.gen(function* () {
				const manifest = yield* ActionManifest.read("/repo/action.yml");
				assert.strictEqual(manifest.name, "Greeter");
			}).pipe(Effect.provide(MemoryFileSystem.layerWith({ "/repo/action.yml": NODE_MANIFEST }))),
		);

		it.effect("fails with the path when the file is missing", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(ActionManifest.read("/repo/missing.yml"));
				assert.strictEqual(error._tag, "ActionManifestReadError");
				if (error._tag === "ActionManifestReadError") {
					assert.strictEqual(error.path, "/repo/missing.yml");
				}
			}).pipe(Effect.provide(MemoryFileSystem.layerWith({}))),
		);
	});

	describe("runnerInputs", () => {
		const manifest = decoded(NODE_MANIFEST);

		it("publishes every declared input, with its default or the empty string", () => {
			assert.deepStrictEqual(ActionManifest.runnerInputs(manifest), {
				INPUT_NAME: "world",
				INPUT_GUESTS: "",
				INPUT_EMPHATIC: "false",
				INPUT_RETRIES: "3",
				"INPUT_WRITE-SUMMARY": "true",
				INPUT_TOKEN: TOKEN_EXPR,
				"INPUT_OLD-FLAG": "",
			});
		});

		it("keeps the dash in a hyphenated name and turns spaces into underscores", () => {
			const env = ActionManifest.runnerInputs(
				decoded(
					"name: X\ninputs:\n  write-summary:\n    default: 'yes'\n  my input:\n    default: v\nruns:\n  using: node24\n  main: m.js\n",
				),
			);
			assert.deepStrictEqual(env, { "INPUT_WRITE-SUMMARY": "yes", INPUT_MY_INPUT: "v" });
			assert.isFalse("INPUT_WRITE_SUMMARY" in env);
		});

		it("lets a supplied value win, even when it is empty", () => {
			const env = ActionManifest.runnerInputs(manifest, { name: "panel", "write-summary": "" });
			assert.strictEqual(env.INPUT_NAME, "panel");
			assert.strictEqual(env["INPUT_WRITE-SUMMARY"], "");
			assert.strictEqual(env.INPUT_EMPHATIC, "false");
		});

		it("throws on a supplied input the manifest does not declare", () => {
			assert.throws(() => ActionManifest.runnerInputs(manifest, { write_summary: "false" }), /write_summary/);
		});

		it.effect("is the baseline ActionInput reads: manifest defaults, not code fallbacks", () =>
			Effect.gen(function* () {
				const read = Effect.all({
					name: ActionInput.string("name").pipe(Config.withDefault("code-default")),
					summary: ActionInput.boolean("write-summary").pipe(Config.withDefault(false)),
					guests: ActionInput.list("guests").pipe(Config.withDefault<ReadonlyArray<string>>([])),
				});
				const asRunner = yield* read.pipe(Effect.provide(ActionInput.layer(ActionManifest.runnerInputs(manifest))));
				assert.deepStrictEqual(asRunner, { name: "world", summary: true, guests: [] });
				// The control: an empty environment takes the code's fallbacks instead.
				const bare = yield* read.pipe(Effect.provide(ActionInput.layer({})));
				assert.deepStrictEqual(bare, { name: "code-default", summary: false, guests: [] });
			}),
		);

		it.effect("spreads into ActionEnvironment.layerTest's overrides", () =>
			Effect.gen(function* () {
				const env = yield* ActionEnvironment;
				const value = yield* env.get("INPUT_WRITE-SUMMARY");
				assert.deepStrictEqual(value, "true");
			}).pipe(Effect.provide(ActionEnvironment.layerTest(ActionManifest.runnerInputs(manifest)))),
		);
	});

	describe("diff", () => {
		const manifest = decoded(NODE_MANIFEST);
		const allInputs = ["name", "guests", "emphatic", "retries", "write-summary", "token", "old-flag"];

		it("is in sync when the code reads and writes exactly what is declared", () => {
			const diff = ActionManifest.diff(manifest, { inputs: allInputs, outputs: ["greeting", "result"] });
			assert.isTrue(diff.inSync);
			assert.deepStrictEqual(
				diff,
				new ActionManifestDiff({ unreadInputs: [], undeclaredInputs: [], unwrittenOutputs: [], undeclaredOutputs: [] }),
			);
		});

		it("reports declared inputs the code never reads", () => {
			const diff = ActionManifest.diff(manifest, { inputs: allInputs.filter((name) => name !== "guests") });
			assert.deepStrictEqual(diff.unreadInputs, ["guests"]);
			assert.deepStrictEqual(diff.undeclaredInputs, []);
			assert.isFalse(diff.inSync);
		});

		it("reports inputs the code reads that the manifest never declares", () => {
			const diff = ActionManifest.diff(manifest, { inputs: [...allInputs, "dry-run", "dry-run"] });
			assert.deepStrictEqual(diff.undeclaredInputs, ["dry-run"]);
			assert.deepStrictEqual(diff.unreadInputs, []);
			assert.isFalse(diff.inSync);
		});

		it("matches inputs by runner variable, so case and spaces fold as on a runner", () => {
			const diff = ActionManifest.diff(manifest, {
				inputs: allInputs.map((name) => (name === "write-summary" ? "WRITE-SUMMARY" : name)),
			});
			assert.isTrue(diff.inSync);
		});

		it("reports output drift in both directions", () => {
			const diff = ActionManifest.diff(manifest, { inputs: allInputs, outputs: ["greeting", "extra"] });
			assert.deepStrictEqual(diff.unwrittenOutputs, ["result"]);
			assert.deepStrictEqual(diff.undeclaredOutputs, ["extra"]);
			assert.isFalse(diff.inSync);
		});

		it("skips outputs when the usage names none", () => {
			const diff = ActionManifest.diff(manifest, { inputs: allInputs });
			assert.deepStrictEqual(diff.unwrittenOutputs, []);
			assert.isTrue(diff.inSync);
		});
	});
});
