// Ported from @savvy-web/github-action-builder __test__/services/validation-ci.test.ts and services.test.ts, over memfs.
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, PlatformError, Schema } from "effect";
import { ActionConfig, ActionValidation, ValidationResult } from "../../src/index.js";

const CWD = "/action";

const GOOD_YML = `name: test
description: A test action
runs:
  using: node24
  main: dist/main.js
branding:
  icon: zap
  color: blue
`;

const configOf = (document: unknown = {}) => Schema.decodeUnknownSync(ActionConfig)(document);

const validate = (
	seed: Readonly<Record<string, string>>,
	document: unknown = {},
	options: { readonly ci: boolean } = { ci: false },
) =>
	ActionValidation.validate(configOf(document), CWD, options).pipe(
		Effect.provide(MemoryFileSystem.layerWithPath(seed)),
	);

const good = { [`${CWD}/src/main.ts`]: "", [`${CWD}/action.yml`]: GOOD_YML };

const codes = (issues: ReadonlyArray<{ readonly code: string }>) => issues.map((issue) => issue.code);

describe("ActionValidation.isCI", () => {
	it("is false for an empty environment and for CI=false / CI=0", () => {
		assert.isFalse(ActionValidation.isCI({}));
		assert.isFalse(ActionValidation.isCI({ CI: "false" }));
		assert.isFalse(ActionValidation.isCI({ CI: "0" }));
	});

	it("is true for CI=true, CI=1 and GITHUB_ACTIONS=true", () => {
		assert.isTrue(ActionValidation.isCI({ CI: "true" }));
		assert.isTrue(ActionValidation.isCI({ CI: "1" }));
		assert.isTrue(ActionValidation.isCI({ GITHUB_ACTIONS: "true" }));
	});

	it("is true for another provider's marker or CONTINUOUS_INTEGRATION", () => {
		assert.isTrue(ActionValidation.isCI({ GITLAB_CI: "true" }));
		assert.isTrue(ActionValidation.isCI({ CONTINUOUS_INTEGRATION: "true" }));
	});
});

describe("ActionValidation.validate", () => {
	it.effect("passes a valid project structure", () =>
		Effect.gen(function* () {
			const result = yield* validate(good);
			assert.instanceOf(result, ValidationResult);
			assert.isTrue(result.valid);
			assert.deepStrictEqual(result.errors, []);
			assert.deepStrictEqual(result.warnings, []);
		}),
	);

	it.effect("reports a missing main entry as an error, with its path and a suggestion", () =>
		Effect.gen(function* () {
			const result = yield* validate({ [`${CWD}/action.yml`]: GOOD_YML });
			assert.isFalse(result.valid);
			assert.deepStrictEqual(codes(result.errors), ["MAIN_ENTRY_MISSING"]);
			const error = result.errors[0];
			assert.strictEqual(error?.message, "Main entry point not found: src/main.ts");
			assert.strictEqual(error?.file, "src/main.ts");
			assert.strictEqual(error?.suggestion, "Create src/main.ts or specify a different path in config");
		}),
	);

	it.effect("reads the configured main path", () =>
		Effect.gen(function* () {
			const result = yield* validate(
				{ [`${CWD}/src/run.ts`]: "", [`${CWD}/action.yml`]: GOOD_YML },
				{ entries: { main: "src/run.ts" } },
			);
			assert.deepStrictEqual(result.errors, []);
		}),
	);

	it.effect("warns on a missing action.yml, and an empty project is still valid outside strict mode", () =>
		Effect.gen(function* () {
			const result = yield* validate({ [`${CWD}/src/main.ts`]: "" });
			assert.isTrue(result.valid);
			assert.deepStrictEqual(codes(result.warnings), ["ACTION_YML_MISSING"]);
			const warning = result.warnings[0];
			assert.strictEqual(warning?.message, "action.yml not found");
			assert.strictEqual(warning?.file, `${CWD}/action.yml`);
			assert.strictEqual(warning?.suggestion, "Create action.yml to define your action metadata");
		}),
	);

	it.effect("does not read action.yml when it is not required", () =>
		Effect.gen(function* () {
			const result = yield* validate(
				{ [`${CWD}/src/main.ts`]: "", [`${CWD}/action.yml`]: ": : :\n\t" },
				{ validation: { requireActionYml: false } },
			);
			assert.isTrue(result.valid);
			assert.deepStrictEqual(result.warnings, []);
		}),
	);

	it.effect("reports broken YAML and a non-object document as syntax errors", () =>
		Effect.gen(function* () {
			const broken = yield* validate({ ...good, [`${CWD}/action.yml`]: "name: [unclosed\n" });
			assert.deepStrictEqual(codes(broken.errors), ["ACTION_YML_SYNTAX_ERROR"]);
			assert.strictEqual(broken.errors[0]?.file, `${CWD}/action.yml`);
			assert.isFalse(broken.valid);

			const scalar = yield* validate({ ...good, [`${CWD}/action.yml`]: "just a string\n" });
			assert.deepStrictEqual(codes(scalar.errors), ["ACTION_YML_SYNTAX_ERROR"]);
			assert.strictEqual(scalar.errors[0]?.message, "action.yml must be an object");
		}),
	);

	it.effect("reports a document the schema rejects", () =>
		Effect.gen(function* () {
			const result = yield* validate({
				...good,
				[`${CWD}/action.yml`]: "name: a\ndescription: b\nruns:\n  using: node20\n  main: m\n",
			});
			assert.deepStrictEqual(codes(result.errors), ["ACTION_YML_SCHEMA_ERROR"]);
			assert.include(result.errors[0]?.message ?? "", "using");
		}),
	);

	it.effect("warns on absent branding, naming what to add", () =>
		Effect.gen(function* () {
			const result = yield* validate({
				...good,
				[`${CWD}/action.yml`]: "name: a\ndescription: b\nruns:\n  using: node24\n  main: m\n",
			});
			assert.deepStrictEqual(codes(result.warnings), ["ACTION_YML_NO_BRANDING"]);
			assert.strictEqual(result.warnings[0]?.message, "No branding configuration found");
			assert.strictEqual(
				result.warnings[0]?.suggestion,
				"Add branding.icon and branding.color for better marketplace visibility",
			);
		}),
	);

	it.effect("warns on a missing icon, a missing color and an empty description", () =>
		Effect.gen(function* () {
			const noIcon = yield* validate({ ...good, [`${CWD}/action.yml`]: GOOD_YML.replace("  icon: zap\n", "") });
			assert.deepStrictEqual(codes(noIcon.warnings), ["ACTION_YML_NO_BRANDING_ICON"]);
			assert.strictEqual(noIcon.warnings[0]?.message, "Branding icon not specified");

			const noColor = yield* validate({ ...good, [`${CWD}/action.yml`]: GOOD_YML.replace("  color: blue\n", "") });
			assert.deepStrictEqual(codes(noColor.warnings), ["ACTION_YML_NO_BRANDING_COLOR"]);
			assert.strictEqual(noColor.warnings[0]?.message, "Branding color not specified");

			const descriptions = yield* validate({
				...good,
				[`${CWD}/action.yml`]: `${GOOD_YML}inputs:\n  a:\n    description: ""\noutputs:\n  b:\n    description: ""\n`,
			});
			assert.deepStrictEqual(codes(descriptions.warnings), [
				"ACTION_YML_INPUT_NO_DESCRIPTION",
				"ACTION_YML_OUTPUT_NO_DESCRIPTION",
			]);
			assert.strictEqual(descriptions.warnings[0]?.message, "Input 'a' has no description");
			assert.strictEqual(descriptions.warnings[1]?.suggestion, "Add a description for the 'b' output");
		}),
	);

	it.effect("checks worker names and worker sources", () =>
		Effect.gen(function* () {
			const reserved = yield* validate(good, { entries: { workers: { main: "src/main.ts" } } });
			assert.deepStrictEqual(codes(reserved.errors), ["WORKER_ENTRY_INVALID_NAME"]);
			assert.include(reserved.errors[0]?.message ?? "", "reserved lifecycle bundle name");

			for (const name of ["a/b", "a\\b", "..", ""]) {
				const unsafe = yield* validate(good, { entries: { workers: { [name]: "src/main.ts" } } });
				assert.deepStrictEqual(codes(unsafe.errors), ["WORKER_ENTRY_INVALID_NAME"], name);
			}

			const missing = yield* validate(good, { entries: { workers: { silk: "src/silk.ts" } } });
			assert.deepStrictEqual(codes(missing.errors), ["WORKER_ENTRY_MISSING"]);
			assert.strictEqual(missing.errors[0]?.file, "src/silk.ts");
			assert.isFalse(missing.valid);

			const present = yield* validate(
				{ ...good, [`${CWD}/src/silk.ts`]: "" },
				{ entries: { workers: { silk: "src/silk.ts" } } },
			);
			assert.deepStrictEqual(present.errors, []);
		}),
	);

	it.effect(
		"errors on an explicit pre or post whose file is missing, and takes the conventional ones as optional",
		() =>
			Effect.gen(function* () {
				const missing = yield* validate(good, { entries: { pre: "src/setup.ts", post: "src/teardown.ts" } });
				assert.isFalse(missing.valid);
				assert.deepStrictEqual(codes(missing.errors), ["ENTRY_FILE_MISSING", "ENTRY_FILE_MISSING"]);
				assert.strictEqual(missing.errors[0]?.file, "src/setup.ts");
				assert.include(missing.errors[1]?.message ?? "", "post");

				const implicit = yield* validate(good);
				assert.deepStrictEqual(implicit.errors, []);

				const present = yield* validate({ ...good, [`${CWD}/src/setup.ts`]: "" }, { entries: { pre: "src/setup.ts" } });
				assert.deepStrictEqual(present.errors, []);
			}),
	);

	it.effect("reports an unreadable maxBundleSize before any build", () =>
		Effect.gen(function* () {
			const result = yield* validate(good, { validation: { maxBundleSize: "big" } });
			assert.deepStrictEqual(codes(result.errors), ["MAX_BUNDLE_SIZE_INVALID"]);
		}),
	);

	it.effect("turns warnings invalid in strict mode, from config or from CI", () =>
		Effect.gen(function* () {
			const seed = { [`${CWD}/src/main.ts`]: "" };
			const configured = yield* validate(seed, { validation: { strict: true } });
			assert.isFalse(configured.valid);
			assert.deepStrictEqual(codes(configured.warnings), ["ACTION_YML_MISSING"]);

			const inCi = yield* validate(seed, {}, { ci: true });
			assert.isFalse(inCi.valid);

			const overridden = yield* validate(seed, { validation: { strict: false } }, { ci: true });
			assert.isTrue(overridden.valid);
		}),
	);

	it.effect("fails with the PlatformError when action.yml cannot be read", () =>
		Effect.gen(function* () {
			const error = yield* ActionValidation.validate(configOf(), CWD, { ci: false }).pipe(
				Effect.provide(
					MemoryFileSystem.layerWithPath(good, {
						faults: {
							readFileString: (path) =>
								path.endsWith("action.yml")
									? Effect.fail(
											PlatformError.systemError({
												_tag: "PermissionDenied",
												module: "FileSystem",
												method: "readFileString",
												pathOrDescriptor: path,
											}),
										)
									: undefined,
						},
					}),
				),
				Effect.flip,
			);
			assert.strictEqual(error._tag, "PlatformError");
		}),
	);
});

describe("ActionValidation.checkBundleSizes", () => {
	const stats = [
		{ entry: "main", size: 2 * 1024 * 1024, outputPath: "dist/main.js" },
		{ entry: "pre", size: 1024, outputPath: "dist/pre.js" },
	];
	const configWith = (maxBundleSize?: string) =>
		configOf({ validation: maxBundleSize === undefined ? {} : { maxBundleSize } });

	it("reports nothing with no limit, or within it", () => {
		assert.deepStrictEqual(ActionValidation.checkBundleSizes(configWith(), stats), []);
		assert.deepStrictEqual(ActionValidation.checkBundleSizes(configWith("2mb"), stats), []);
	});

	it("reports each bundle past the limit, reading the unit case-insensitively", () => {
		const issues = ActionValidation.checkBundleSizes(configWith("500KB"), stats);
		assert.deepStrictEqual(codes(issues), ["MAX_BUNDLE_SIZE_EXCEEDED"]);
		assert.strictEqual(issues[0]?.file, "dist/main.js");
		assert.include(issues[0]?.message ?? "", "main");
		assert.include(issues[0]?.message ?? "", "2.0 MB");
		assert.include(issues[0]?.message ?? "", "500KB");
	});

	it("fractions and a bare byte unit parse", () => {
		assert.deepStrictEqual(codes(ActionValidation.checkBundleSizes(configWith("1.5mb"), stats)), [
			"MAX_BUNDLE_SIZE_EXCEEDED",
		]);
		assert.lengthOf(ActionValidation.checkBundleSizes(configWith("100b"), stats), 2);
	});
});
