// PackageLockDocument.parse: package-lock.json text read as npm's native
// document, with the typed LockfileDocumentError for each stage that can fail.
// Fixtures are copies of @effected/lockfiles' own; provenance in
// fixtures/lockfiles/README.md.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { LockfileDocumentError } from "../src/LockfileDocumentError.js";
import { PackageLockDocument } from "../src/PackageLockDocument.js";

const fixture = (name: string): string =>
	readFileSync(join(import.meta.dirname, "fixtures", "lockfiles", name, "package-lock.json.fixture"), "utf8");

describe("PackageLockDocument.parse", () => {
	it.effect("decodes a lockfileVersion 3 workspace lockfile", () =>
		Effect.gen(function* () {
			const document = yield* PackageLockDocument.parse(fixture("v2"));
			assert.instanceOf(document, PackageLockDocument);
			assert.strictEqual(document.lockfileVersion, 3);
			assert.strictEqual(document.name, "test-npm-monorepo");
			assert.isTrue(Object.hasOwn(document.packages, ""));
			assert.deepStrictEqual(document.packages[""]?.workspaces, ["packages/*"]);
			assert.isAbove(Object.keys(document.packages).length, 100);
		}),
	);

	it.effect("a lockfileVersion 1 tree fails 'version' before the shape decode", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(PackageLockDocument.parse(fixture("unsupported-v1")));
			assert.instanceOf(error, LockfileDocumentError);
			assert.strictEqual(error.format, "npm");
			assert.strictEqual(error.reason, "version");
			assert.strictEqual(error.lockfileVersion, 1);
			assert.strictEqual(error.minimumSupported, PackageLockDocument.minimumLockfileVersion);
		}),
	);

	it.effect("a non-numeric lockfileVersion fails 'version'", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(PackageLockDocument.parse('{ "lockfileVersion": "next", "packages": {} }'));
			assert.strictEqual(error.reason, "version");
			assert.strictEqual(error.lockfileVersion, "next");
		}),
	);

	it.effect("malformed JSON fails 'syntax' with the engine's error as the cause", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(PackageLockDocument.parse('{ "lockfileVersion": 3, '));
			assert.strictEqual(error.reason, "syntax");
			assert.instanceOf(error.cause, SyntaxError);
		}),
	);

	it.effect("a v3 document with no packages map fails 'shape'", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(PackageLockDocument.parse('{ "lockfileVersion": 3 }'));
			assert.strictEqual(error.reason, "shape");
			assert.isDefined(error.cause);
		}),
	);
});
