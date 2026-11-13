// PnpmLockDocument.parse and PnpmEnvDocument.parse: pnpm-lock.yaml text read
// as pnpm's native documents (the lockfile, the env preamble ahead of it),
// with the typed LockfileDocumentError for each stage that can fail.
// Fixtures are copies of @effected/lockfiles' own; provenance in
// fixtures/lockfiles/README.md.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { PnpmEnvDocument } from "../src/PnpmEnvDocument.js";
import { PnpmLockDocument } from "../src/PnpmLockDocument.js";

const fixture = (name: string): string =>
	readFileSync(join(import.meta.dirname, "fixtures", "lockfiles", name, "pnpm-lock.yaml.fixture"), "utf8");

describe("PnpmLockDocument.parse", () => {
	it.effect("decodes a lockfileVersion 9 workspace lockfile with its header", () =>
		Effect.gen(function* () {
			const document = yield* PnpmLockDocument.parse(fixture("v2"));
			assert.instanceOf(document, PnpmLockDocument);
			assert.strictEqual(document.lockfileVersion, "9.0");
			assert.isTrue(Object.hasOwn(document.importers, "."));
			assert.isAbove(Object.keys(document.importers).length, 1);
			assert.isDefined(document.settings);
			assert.isDefined(document.catalogs);
			assert.isDefined(document.overrides);
			assert.isDefined(document.packages);
			assert.isDefined(document.snapshots);
		}),
	);

	it.effect("reads the LAST document of a two-document stream, never the preamble", () =>
		Effect.gen(function* () {
			const document = yield* PnpmLockDocument.parse(fixture("env-configdeps-pnpm12"));
			// The preamble records only the config dependency; the lockfile records the settings header.
			assert.isDefined(document.settings);
			assert.isFalse(
				Object.keys(document.packages ?? {}).some((key) => key.startsWith("@effected/pnpm-plugin-effect")),
			);
		}),
	);

	it.effect("a lockfileVersion '6.0' lockfile fails 'version'", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(PnpmLockDocument.parse(fixture("unsupported-v6")));
			assert.strictEqual(error.format, "pnpm");
			assert.strictEqual(error.reason, "version");
			assert.strictEqual(error.lockfileVersion, "6.0");
			assert.strictEqual(error.minimumSupported, PnpmLockDocument.minimumLockfileVersion);
		}),
	);

	it.effect("a pre-v9 single-project lockfile with no importers fails 'version', not 'shape'", () =>
		Effect.gen(function* () {
			// No importers map, so a shape-first order would report this too-old
			// lockfile as malformed: the gate must run before the shape decode.
			const error = yield* Effect.flip(PnpmLockDocument.parse(fixture("unsupported-v6-single")));
			assert.strictEqual(error.reason, "version");
			assert.strictEqual(error.lockfileVersion, "6.0");
		}),
	);

	it.effect("malformed YAML fails 'syntax' with the first diagnostic's line", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				PnpmLockDocument.parse("lockfileVersion: '9.0'\nimporters:\n  - [unclosed\n\tflow"),
			);
			assert.strictEqual(error.reason, "syntax");
			assert.isDefined(error.cause);
			assert.isNumber(error.line);
		}),
	);

	it.effect("more than two documents fail 'framing' with unexpectedDocuments and the count", () =>
		Effect.gen(function* () {
			const v2 = fixture("v2");
			const error = yield* Effect.flip(PnpmLockDocument.parse(`${v2}---\n${v2}---\n${v2}`));
			assert.strictEqual(error.reason, "framing");
			assert.strictEqual(error.framing, "unexpectedDocuments");
			assert.strictEqual(error.documents, 3);
		}),
	);

	it.effect("empty content fails 'framing' with noLockfileDocument", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(PnpmLockDocument.parse(""));
			assert.strictEqual(error.framing, "noLockfileDocument");
			assert.strictEqual(error.documents, 1);
		}),
	);

	it.effect("a document with an empty importers map fails 'framing' with noImporters", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(PnpmLockDocument.parse("lockfileVersion: '9.0'\nimporters: {}\n"));
			assert.strictEqual(error.framing, "noImporters");
		}),
	);

	it.effect("a v9 document with no importers key fails 'shape'", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(PnpmLockDocument.parse("lockfileVersion: '9.0'\n"));
			assert.strictEqual(error.reason, "shape");
		}),
	);
});

describe("PnpmEnvDocument.parse", () => {
	it.effect("reads the FIRST of two documents", () =>
		Effect.gen(function* () {
			const preamble = yield* PnpmEnvDocument.parse(fixture("env-configdeps-pnpm12"));
			assert.isTrue(Option.isSome(preamble));
			if (Option.isNone(preamble)) return;
			assert.instanceOf(preamble.value, PnpmEnvDocument);
			assert.strictEqual(preamble.value.lockfileVersion, "9.0");
			const declared = preamble.value.importers?.["."]?.configDependencies;
			assert.deepStrictEqual(declared?.["@effected/pnpm-plugin-effect"], { specifier: "0.11.1", version: "0.11.1" });
		}),
	);

	it.effect("a single-document lockfile has no preamble", () =>
		Effect.gen(function* () {
			assert.isTrue(Option.isNone(yield* PnpmEnvDocument.parse(fixture("v2"))));
		}),
	);

	it.effect("a preamble below lockfileVersion 9 fails 'version'", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(PnpmEnvDocument.parse(`lockfileVersion: '6.0'\n---\n${fixture("v2")}`));
			assert.strictEqual(error.reason, "version");
			assert.strictEqual(error.lockfileVersion, "6.0");
		}),
	);
});
