// Ported from savvy-web/systems packages/tsdown-plugins/__test__/config-validation/validator.test.ts on 2026-11-06

import { assert, layer } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer } from "effect";
import type { ValidationInput } from "../../src/config-validation/ConfigValidator.js";
import { ConfigValidator } from "../../src/config-validation/ConfigValidator.js";

const validate = (input: ValidationInput) => Effect.flatMap(ConfigValidator, (v) => v.validate(input));

/** Asserts the input is rejected through the TYPED error channel, not as a defect. */
const expectInvalid = (input: ValidationInput) =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(validate(input));
		assert.strictEqual(error._tag, "ConfigValidationError");
	});

const ok: ValidationInput = { baseName: "pkg", hasExports: true };

// The meta.localPaths rule stats through FileSystem: a file in the way, a directory, and nothing at all.
const volume = MemoryFileSystem.makeSync({ "/ws/models/file": "", "/ws/models/dir/keep": "" });

layer(ConfigValidator.layer.pipe(Layer.provide(volume.layer)))("ConfigValidator", (it) => {
	it.effect("fails a localPaths entry that exists but is not a directory", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(validate({ ...ok, meta: { localPaths: ["/ws/models/file"] } }));
			assert.strictEqual(error.path, "meta.localPaths");
			assert.include(error.reason, "/ws/models/file");
		}),
	);

	it.effect("passes a localPaths entry that is a directory or does not exist yet", () =>
		validate({ ...ok, meta: { localPaths: ["/ws/models/dir", "/ws/models/absent"] } }),
	);

	it.effect("checks localPaths after the tag definitions and before looseFiles", () =>
		Effect.gen(function* () {
			const meta = {
				localPaths: ["/ws/models/file"],
				tsdoc: { tagDefinitions: [{ tagName: "@x", syntaxKind: "nope" as never }] },
			};
			assert.strictEqual((yield* Effect.flip(validate({ ...ok, meta }))).path, "meta.tsdoc.tagDefinitions");
			const loose = yield* Effect.flip(
				validate({ ...ok, meta: { localPaths: ["/ws/models/file"] }, looseFiles: { "x.txt": "./src/x.ts" } as never }),
			);
			assert.strictEqual(loose.path, "meta.localPaths");
		}),
	);

	it.effect("passes a minimal valid config", () => validate({ ...ok }));

	it.effect("fails a dangling `from` target", () =>
		expectInvalid({ ...ok, targets: { a: { from: "nope", registry: "https://r" } } }),
	);

	it.effect("fails a from+name collision", () =>
		expectInvalid({
			...ok,
			targets: { npm: true, a: { from: "npm", name: "@s/x", registry: "https://r" } },
		}),
	);

	it.effect("fails a custom target key with no registry", () =>
		expectInvalid({ ...ok, targets: { custom: { name: "@s/x" } } }),
	);

	it.effect("fails an exe config with no fileName", () =>
		expectInvalid({ ...ok, exe: { fileName: "" }, osCpu: { os: ["darwin"], cpu: ["arm64"] } }),
	);

	it.effect("fails an exe config whose targets are empty after os/cpu inference", () =>
		expectInvalid({ ...ok, exe: { fileName: "tool" }, osCpu: { os: [], cpu: [] } }),
	);

	it.effect("fails a meta tagDefinition with an invalid syntaxKind", () =>
		expectInvalid({
			...ok,
			meta: { tsdoc: { tagDefinitions: [{ tagName: "@x", syntaxKind: "bogus" as never }] } },
		}),
	);

	it.effect("fails when a package without exports asks to emit a model", () =>
		expectInvalid({ baseName: "pkg", hasExports: false, meta: { localPaths: ["x"] } }),
	);

	it.effect("passes valid looseFiles", () => validate({ ...ok, looseFiles: { "pnpmfile.mjs": "./src/pnpmfile.ts" } }));

	it.effect("fails looseFiles with an ambiguous .js key and no explicit format", () =>
		expectInvalid({ ...ok, looseFiles: { "thing.js": "./src/thing.ts" } }),
	);

	it.effect("fails looseFiles with a format that contradicts the extension", () =>
		expectInvalid({ ...ok, looseFiles: { "pnpmfile.mjs": { source: "./s.ts", format: "cjs" } } }),
	);
});
