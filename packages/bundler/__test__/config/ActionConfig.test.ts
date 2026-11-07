// Ported from @savvy-web/github-action-builder __test__/schemas/config.test.ts, minus nativeDynamicImports and defineConfig.
import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema, SchemaIssue } from "effect";
import {
	ActionBuildOptions,
	ActionConfig,
	ActionEntries,
	ActionPersistLocalOptions,
	ActionValidationOptions,
	EffectedConfig,
} from "../../src/index.js";

const strict = { onExcessProperty: "error", errors: "all" } as const;

const decode = (document: unknown) => Schema.decodeUnknownEffect(ActionConfig)(document, strict);

const failedPaths = (document: unknown) =>
	decode(document).pipe(
		Effect.flip,
		Effect.map((error) => SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map((issue) => issue.path)),
	);

describe("ActionEntries", () => {
	const entries = (document: unknown) => Schema.decodeUnknownEffect(ActionEntries)(document, strict);

	it.effect("applies defaults when decoding an empty table", () =>
		Effect.gen(function* () {
			const decoded = yield* entries({});
			assert.instanceOf(decoded, ActionEntries);
			assert.strictEqual(decoded.main, "src/main.ts");
			assert.notProperty(decoded, "pre");
			assert.notProperty(decoded, "post");
			assert.deepStrictEqual(decoded.workers, {});
		}),
	);

	it.effect("accepts a custom main entry", () =>
		Effect.gen(function* () {
			const decoded = yield* entries({ main: "src/action.ts" });
			assert.strictEqual(decoded.main, "src/action.ts");
		}),
	);

	it.effect("accepts every lifecycle entry and the workers", () =>
		Effect.gen(function* () {
			const decoded = yield* entries({
				main: "src/main.ts",
				pre: "src/pre.ts",
				post: "src/post.ts",
				workers: { "changelog-silk": "src/changelog/silk.ts" },
			});
			assert.strictEqual(decoded.main, "src/main.ts");
			assert.strictEqual(decoded.pre, "src/pre.ts");
			assert.strictEqual(decoded.post, "src/post.ts");
			assert.deepStrictEqual(decoded.workers, { "changelog-silk": "src/changelog/silk.ts" });
		}),
	);

	it.effect("rejects a worker whose source is not a string", () =>
		Effect.gen(function* () {
			const paths = yield* failedPaths({ entries: { workers: { silk: 1 } } });
			assert.deepStrictEqual(paths, [["entries", "workers", "silk"]]);
		}),
	);
});

describe("ActionBuildOptions", () => {
	const build = (document: unknown) => Schema.decodeUnknownEffect(ActionBuildOptions)(document, strict);

	it.effect("applies defaults when decoding an empty table", () =>
		Effect.gen(function* () {
			const decoded = yield* build({});
			assert.instanceOf(decoded, ActionBuildOptions);
			assert.strictEqual(decoded.minify, true);
			assert.strictEqual(decoded.sourceMap, false);
			assert.deepStrictEqual(decoded.externals, []);
			assert.deepStrictEqual(decoded.ignore, []);
		}),
	);

	it.effect("accepts custom options", () =>
		Effect.gen(function* () {
			const decoded = yield* build({
				minify: false,
				sourceMap: true,
				externals: ["@aws-sdk/client-s3"],
				ignore: ["libxmljs2"],
			});
			assert.strictEqual(decoded.minify, false);
			assert.strictEqual(decoded.sourceMap, true);
			assert.deepStrictEqual(decoded.externals, ["@aws-sdk/client-s3"]);
			assert.deepStrictEqual(decoded.ignore, ["libxmljs2"]);
		}),
	);

	it.effect("fails nativeDynamicImports as an unknown key like any other", () =>
		Effect.gen(function* () {
			const paths = yield* failedPaths({ build: { nativeDynamicImports: ["@changesets/apply-release-plan"] } });
			assert.deepStrictEqual(paths, [["build", "nativeDynamicImports"]]);
		}),
	);
});

describe("ActionValidationOptions", () => {
	const validation = (document: unknown) => Schema.decodeUnknownEffect(ActionValidationOptions)(document, strict);

	it.effect("applies defaults when decoding an empty table", () =>
		Effect.gen(function* () {
			const decoded = yield* validation({});
			assert.instanceOf(decoded, ActionValidationOptions);
			assert.strictEqual(decoded.requireActionYml, true);
			assert.notProperty(decoded, "maxBundleSize");
			assert.notProperty(decoded, "strict");
		}),
	);

	it.effect("accepts custom options", () =>
		Effect.gen(function* () {
			const decoded = yield* validation({ requireActionYml: false, maxBundleSize: "5mb", strict: true });
			assert.strictEqual(decoded.requireActionYml, false);
			assert.strictEqual(decoded.maxBundleSize, "5mb");
			assert.strictEqual(decoded.strict, true);
		}),
	);

	it.effect("keeps an explicit strict = false apart from an absent one", () =>
		Effect.gen(function* () {
			const decoded = yield* validation({ strict: false });
			assert.strictEqual(decoded.strict, false);
		}),
	);
});

describe("ActionPersistLocalOptions", () => {
	const persistLocal = (document: unknown) => Schema.decodeUnknownEffect(ActionPersistLocalOptions)(document, strict);

	it.effect("applies defaults when decoding an empty table", () =>
		Effect.gen(function* () {
			const decoded = yield* persistLocal({});
			assert.instanceOf(decoded, ActionPersistLocalOptions);
			assert.strictEqual(decoded.enabled, true);
			assert.strictEqual(decoded.path, ".github/actions/local");
			assert.strictEqual(decoded.actTemplate, true);
		}),
	);

	it.effect("accepts custom options", () =>
		Effect.gen(function* () {
			const decoded = yield* persistLocal({ enabled: false, path: ".github/actions/custom", actTemplate: false });
			assert.strictEqual(decoded.enabled, false);
			assert.strictEqual(decoded.path, ".github/actions/custom");
			assert.strictEqual(decoded.actTemplate, false);
		}),
	);
});

describe("ActionConfig", () => {
	it.effect("decodes an empty table to every nested default", () =>
		Effect.gen(function* () {
			const config = yield* decode({});
			assert.instanceOf(config, ActionConfig);
			assert.instanceOf(config.entries, ActionEntries);
			assert.instanceOf(config.build, ActionBuildOptions);
			assert.instanceOf(config.validation, ActionValidationOptions);
			assert.instanceOf(config.persistLocal, ActionPersistLocalOptions);
			assert.strictEqual(config.entries.main, "src/main.ts");
			assert.strictEqual(config.build.minify, true);
			assert.strictEqual(config.validation.requireActionYml, true);
			assert.strictEqual(config.persistLocal.enabled, true);
			assert.strictEqual(config.persistLocal.path, ".github/actions/local");
			assert.strictEqual(config.persistLocal.actTemplate, true);
		}),
	);

	it.effect("merges a partial table with the defaults", () =>
		Effect.gen(function* () {
			const config = yield* decode({ entries: { main: "src/action.ts" }, build: { minify: false } });
			assert.strictEqual(config.entries.main, "src/action.ts");
			assert.notProperty(config.entries, "pre");
			assert.strictEqual(config.build.minify, false);
			assert.strictEqual(config.build.sourceMap, false);
		}),
	);

	it.effect("names every unknown key by its full path", () =>
		Effect.gen(function* () {
			const paths = yield* failedPaths({
				name: "x",
				entries: { mian: "src/main.ts" },
				validation: { maxSize: "5mb" },
				persistLocal: { dir: "x" },
			});
			assert.sameDeepMembers(
				paths.map((path) => [...(path ?? [])]),
				[["name"], ["entries", "mian"], ["validation", "maxSize"], ["persistLocal", "dir"]],
			);
		}),
	);

	it.effect("rejects a value of the wrong type under its path", () =>
		Effect.gen(function* () {
			const paths = yield* failedPaths({ build: { minify: "yes" } });
			assert.deepStrictEqual(paths, [["build", "minify"]]);
		}),
	);
});

describe("EffectedConfig.action", () => {
	const decodeConfig = (document: unknown) => Schema.decodeUnknownEffect(EffectedConfig)(document, strict);

	it.effect("is undefined when no action table was written, so a library is not an action", () =>
		Effect.gen(function* () {
			const config = yield* decodeConfig({ package: {} });
			assert.isUndefined(config.action);
		}),
	);

	it.effect("decodes an empty action table to the ActionConfig defaults", () =>
		Effect.gen(function* () {
			const config = yield* decodeConfig({ action: {} });
			assert.instanceOf(config.action, ActionConfig);
			assert.strictEqual(config.action?.entries.main, "src/main.ts");
		}),
	);

	it.effect("names an unknown action key from the document root", () =>
		Effect.gen(function* () {
			const error = yield* decodeConfig({ action: { build: { nativeDynamicImports: [] } } }).pipe(Effect.flip);
			const paths = SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map((issue) => issue.path);
			assert.deepStrictEqual(paths, [["action", "build", "nativeDynamicImports"]]);
		}),
	);
});
