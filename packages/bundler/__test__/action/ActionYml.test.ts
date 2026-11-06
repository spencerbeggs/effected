import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema, SchemaIssue } from "effect";
import { ActionYml, ActionYmlInput, ActionYmlRuns } from "../../src/index.js";

const decode = Schema.decodeUnknownEffect(ActionYml);

const minimal = { name: "a", description: "b", runs: { using: "node24", main: "dist/main.js" } };

const failedPaths = (document: unknown) =>
	decode(document, { errors: "all" }).pipe(
		Effect.flip,
		Effect.map((error) => SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map((issue) => issue.path)),
	);

describe("ActionYml", () => {
	it.effect("decodes the minimal document", () =>
		Effect.gen(function* () {
			const action = yield* decode(minimal);
			assert.instanceOf(action, ActionYml);
			assert.instanceOf(action.runs, ActionYmlRuns);
			assert.strictEqual(action.runs.main, "dist/main.js");
			assert.isUndefined(action.inputs);
			assert.isUndefined(action.branding);
		}),
	);

	it.effect("decodes every field", () =>
		Effect.gen(function* () {
			const action = yield* decode({
				name: "a",
				description: "b",
				author: "c",
				inputs: { token: { description: "d", required: true, default: "e", deprecationMessage: "f" } },
				outputs: { id: { description: "g" } },
				runs: { using: "node24", main: "m", pre: "p", "pre-if": "always()", post: "q", "post-if": "failure()" },
				branding: { icon: "zap", color: "gray-dark" },
			});
			assert.instanceOf(action.inputs?.token, ActionYmlInput);
			assert.strictEqual(action.inputs?.token?.default, "e");
			assert.strictEqual(action.outputs?.id?.description, "g");
			assert.strictEqual(action.runs["post-if"], "failure()");
			assert.strictEqual(action.branding?.icon, "zap");
			assert.strictEqual(action.branding?.color, "gray-dark");
		}),
	);

	it.effect("requires name, description and runs", () =>
		Effect.gen(function* () {
			assert.sameDeepMembers(
				(yield* failedPaths({})).map((path) => [...(path ?? [])]),
				[["name"], ["description"], ["runs"]],
			);
		}),
	);

	it.effect("takes node24 only", () =>
		Effect.gen(function* () {
			const paths = yield* failedPaths({ ...minimal, runs: { using: "node20", main: "m" } });
			assert.deepStrictEqual(paths, [["runs", "using"]]);
		}),
	);

	it.effect("rejects an input with no description and an unknown icon or color", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* failedPaths({ ...minimal, inputs: { a: {} } }), [["inputs", "a", "description"]]);
			assert.deepStrictEqual(yield* failedPaths({ ...minimal, branding: { icon: "not-an-icon" } }), [
				["branding", "icon"],
			]);
			assert.deepStrictEqual(yield* failedPaths({ ...minimal, branding: { color: "pink" } }), [["branding", "color"]]);
		}),
	);
});
