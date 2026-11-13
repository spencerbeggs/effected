// BunLockDocument.parse: bun.lock text read as bun's native document, with
// the typed LockfileDocumentError for each stage that can fail. The fixture is
// a copy of @effected/lockfiles' own; provenance in fixtures/lockfiles/README.md.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { BunLockDocument } from "../src/BunLockDocument.js";

const fixture = (name: string): string =>
	readFileSync(join(import.meta.dirname, "fixtures", "lockfiles", name, "bun.lock.fixture"), "utf8");

describe("BunLockDocument.parse", () => {
	it.effect("decodes a workspace bun.lock with its header", () =>
		Effect.gen(function* () {
			const document = yield* BunLockDocument.parse(fixture("v2"));
			assert.instanceOf(document, BunLockDocument);
			assert.strictEqual(document.lockfileVersion, 1);
			assert.isTrue(Object.hasOwn(document.workspaces ?? {}, ""));
			assert.isTrue(Object.hasOwn(document.workspaces ?? {}, "packages/core"));
			assert.isDefined(document.packages);
			assert.isDefined(document.catalog);
			assert.isDefined(document.catalogs);
		}),
	);

	it.effect("malformed JSONC fails 'syntax' with the first diagnostic's line", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(BunLockDocument.parse('{\n  "lockfileVersion": 1,\n  "workspaces": {'));
			assert.strictEqual(error.format, "bun");
			assert.strictEqual(error.reason, "syntax");
			assert.isNumber(error.line);
		}),
	);

	it.effect("a document whose lockfileVersion is not a number fails 'shape'", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(BunLockDocument.parse('{ "lockfileVersion": "1" }'));
			assert.strictEqual(error.reason, "shape");
			assert.isDefined(error.cause);
		}),
	);

	it.effect("bun records no rejected format version: any numeric lockfileVersion decodes", () =>
		Effect.gen(function* () {
			const document = yield* BunLockDocument.parse('{ "lockfileVersion": 0 }');
			assert.strictEqual(document.lockfileVersion, 0);
		}),
	);
});
