import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Schema } from "effect";
import { PackageBuildConfig } from "../../src/config/BuildConfig.js";
import { ConfigValidationError } from "../../src/errors.js";
import type { BuildEmittedManifestOptions } from "../../src/manifest/emit-manifest.js";
import { buildEmittedManifest } from "../../src/manifest/emit-manifest.js";
import {
	PROTECTED_KEYS,
	STRING_KEYS,
	applyManifestSet,
	emittedPackageName,
	validateManifestSet,
} from "../../src/manifest/manifest-set.js";

/** No group here resolves a catalog, so the emit touches no disk: an empty volume stands in for it. */
const runEmit = (options: BuildEmittedManifestOptions) =>
	Effect.runPromise(buildEmittedManifest(options).pipe(Effect.provide(MemoryFileSystem.makeSync({}).layer)));

const refusal = (run: () => void): ConfigValidationError => {
	try {
		run();
	} catch (error) {
		if (error instanceof ConfigValidationError) return error;
		throw error;
	}
	return assert.fail("expected a ConfigValidationError");
};

describe("[package.build.manifest] set", () => {
	it("decodes to an empty table by default and keeps a written one", () => {
		const decode = Schema.decodeUnknownSync(PackageBuildConfig);
		assert.deepStrictEqual(decode({}).manifest.set, {});
		assert.deepStrictEqual(decode({ manifest: { set: { name: "@modules/versioned" } } }).manifest.set, {
			name: "@modules/versioned",
		});
	});

	it("refuses a non-string value at decode", () => {
		const decode = Schema.decodeUnknownExit(PackageBuildConfig);
		assert.isTrue(decode({ manifest: { set: { sideEffects: false } } })._tag === "Failure");
	});

	it("refuses every key the release or the build owns, naming the key", () => {
		assert.isAtLeast(Object.keys(PROTECTED_KEYS).length, 20);
		for (const [key, reason] of Object.entries(PROTECTED_KEYS)) {
			const error = refusal(() => validateManifestSet({ [key]: "x" }, []));
			assert.strictEqual(error.path, `manifest.set.${key}`);
			assert.include(error.reason, reason);
		}
	});

	it("refuses every key package.json does not type as a string, so a string never publishes over a boolean or array", () => {
		for (const key of [
			"sideEffects",
			"os",
			"cpu",
			"engines",
			"imports",
			"keywords",
			"workspaces",
			"contributors",
			"custom",
		]) {
			const error = refusal(() => validateManifestSet({ [key]: "false" }, []));
			assert.strictEqual(error.path, `manifest.set.${key}`);
			assert.include(error.reason, "types as a string");
		}
		// The two lists never overlap, so no protected key can slip through as a string key.
		assert.deepStrictEqual(
			STRING_KEYS.filter((key) => key in PROTECTED_KEYS),
			[],
		);
	});

	it("refuses a key that is also dropped, an empty key, and an invalid name", () => {
		assert.include(refusal(() => validateManifestSet({ homepage: "x" }, ["homepage"])).reason, "manifest.drop");
		assert.include(refusal(() => validateManifestSet({ "": "x" }, [])).reason, "cannot be empty");
		assert.include(
			refusal(() => validateManifestSet({ name: "Not A Name" }, [])).reason,
			"not a valid npm package name",
		);
	});

	it("accepts a valid name and free-form string keys", () => {
		assert.doesNotThrow(() =>
			validateManifestSet(
				Object.fromEntries(STRING_KEYS.map((key) => [key, key === "name" ? "@modules/versioned" : "x"])),
				["scripts"],
			),
		);
	});

	it("takes the emitted name from set.name, else the source name", () => {
		assert.strictEqual(
			emittedPackageName({ name: "@modules/versioned" }, "@modules/versioned-v1"),
			"@modules/versioned",
		);
		assert.strictEqual(emittedPackageName({}, "@modules/versioned-v1"), "@modules/versioned-v1");
	});

	it("writes every key but name, which the group carries, without mutating its input", () => {
		const pkg = { name: "@a/b", description: "old" };
		const out = applyManifestSet(pkg, { name: "@c/d", description: "new", homepage: "https://x" });
		assert.deepStrictEqual(out, { name: "@a/b", description: "new", homepage: "https://x" });
		assert.strictEqual(pkg.description, "old");
	});

	it("reaches the emitted manifest after the drop", async () => {
		const out = await runEmit({
			cwd: "/abs/pkg",
			pkg: {
				name: "@modules/versioned-v1",
				version: "1.0.0",
				description: "source",
				exports: { ".": "./src/index.ts" },
			},
			targetGroup: { id: "npm", name: "@modules/versioned", isProd: true },
			devManifest: "preserve",
			drop: [],
			set: { description: "the v1 line" },
		});
		assert.strictEqual(out.name, "@modules/versioned");
		assert.strictEqual(out.description, "the v1 line");
		assert.strictEqual(out.version, "1.0.0");
	});

	it("refuses through the public function what the config path refuses", async () => {
		const emit = (set: Record<string, string>) =>
			runEmit({
				cwd: "/abs/pkg",
				pkg: { name: "@x/p", version: "1.0.0", exports: { ".": "./src/index.ts" } },
				targetGroup: { id: "npm", name: "@x/p", isProd: true },
				devManifest: "preserve",
				set,
			});
		for (const [key, path] of [
			["version", "manifest.set.version"],
			["sideEffects", "manifest.set.sideEffects"],
		] as const) {
			const error = await emit({ [key]: "false" }).then(
				() => assert.fail(`expected "${key}" to be refused`),
				(cause: unknown) => cause,
			);
			assert.instanceOf(error, ConfigValidationError);
			assert.strictEqual((error as ConfigValidationError).path, path);
		}
	});

	it("reaches the emitted manifest when no drop list is passed", async () => {
		const out = await runEmit({
			cwd: "/abs/pkg",
			pkg: { name: "@x/p", version: "1.0.0", exports: { ".": "./src/index.ts" } },
			targetGroup: { id: "npm", name: "@x/p", isProd: true },
			devManifest: "preserve",
			set: { description: "set without a drop" },
		});
		assert.strictEqual(out.description, "set without a drop");
	});
});
