// The surgical mutator: `PackageJsonFormat.modify` / `modifyToString`.
//
// The contract under test is BYTE preservation: a tool that changes one field
// in someone else's manifest must not rewrite unrelated regions, so every
// input here is deliberately NOT canonically sorted — the keys are in an order
// the formatter would rewrite — and every assertion is exact-string equality
// against an expected text in which only the edited span differs. A repo that
// runs sort-package-json cannot catch a reorder (the reorder is a no-op
// there); these fixtures can.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { PackageJsonFormat, PackageJsonModifyError, PackageJsonSyntaxError } from "../src/PackageJsonFormat.js";

// Keys deliberately out of canonical order: dependencies before name,
// devEngines before version, scripts unsorted.
const UNSORTED =
	"{\n" +
	'  "dependencies": {\n' +
	'    "zebra": "^1.0.0",\n' +
	'    "apple": "^2.0.0"\n' +
	"  },\n" +
	'  "name": "not-sorted",\n' +
	'  "devEngines": {\n' +
	'    "runtime": {\n' +
	'      "name": "node",\n' +
	'      "version": "24.9.1"\n' +
	"    }\n" +
	"  },\n" +
	'  "version": "0.1.0",\n' +
	'  "scripts": {\n' +
	'    "b": "two",\n' +
	'    "a": "one"\n' +
	"  },\n" +
	'  "packageManager": "pnpm@11.2.0"\n' +
	"}\n";

describe("PackageJsonFormat.modifyToString", () => {
	it.effect("replaces one top-level value and preserves every other byte", () =>
		Effect.gen(function* () {
			const output = yield* PackageJsonFormat.modifyToString(UNSORTED, ["packageManager"], "pnpm@11.3.0");
			assert.strictEqual(output, UNSORTED.replace('"pnpm@11.2.0"', '"pnpm@11.3.0"'));
		}),
	);

	it.effect("replaces a nested value and preserves every other byte", () =>
		Effect.gen(function* () {
			const output = yield* PackageJsonFormat.modifyToString(UNSORTED, ["devEngines", "runtime", "version"], "24.10.0");
			assert.strictEqual(output, UNSORTED.replace('"version": "24.9.1"', '"version": "24.10.0"'));
		}),
	);

	it.effect("inserts a missing key after the container's last key, matching the source indent", () =>
		Effect.gen(function* () {
			const source = '{\n    "private": true\n}\n';
			const output = yield* PackageJsonFormat.modifyToString(source, ["packageManager"], "pnpm@11.2.0");
			assert.strictEqual(output, '{\n    "private": true,\n    "packageManager": "pnpm@11.2.0"\n}\n');
		}),
	);

	it.effect("inserts with tab indentation when the source is tab-indented", () =>
		Effect.gen(function* () {
			const source = '{\n\t"private": true\n}\n';
			const output = yield* PackageJsonFormat.modifyToString(source, ["packageManager"], "pnpm@11.2.0");
			assert.strictEqual(output, '{\n\t"private": true,\n\t"packageManager": "pnpm@11.2.0"\n}\n');
		}),
	);

	it.effect("deletes a key (and its comma) when value is undefined", () =>
		Effect.gen(function* () {
			const source = '{\n  "name": "x",\n  "packageManager": "pnpm@11.2.0"\n}\n';
			const output = yield* PackageJsonFormat.modifyToString(source, ["packageManager"], undefined);
			assert.strictEqual(output, '{\n  "name": "x"\n}\n');
		}),
	);

	it.effect("preserves CRLF line endings in inserted content", () =>
		Effect.gen(function* () {
			const source = '{\r\n  "private": true\r\n}\r\n';
			const output = yield* PackageJsonFormat.modifyToString(source, ["packageManager"], "pnpm@11.2.0");
			assert.strictEqual(output, '{\r\n  "private": true,\r\n  "packageManager": "pnpm@11.2.0"\r\n}\r\n');
		}),
	);

	it.effect("preserves the absence of a trailing newline", () =>
		Effect.gen(function* () {
			const source = '{\n  "packageManager": "pnpm@11.2.0"\n}';
			const output = yield* PackageJsonFormat.modifyToString(source, ["packageManager"], "pnpm@11.3.0");
			assert.strictEqual(output, '{\n  "packageManager": "pnpm@11.3.0"\n}');
		}),
	);

	it.effect("passes a nonsemver version through untouched — the modify path never decodes", () =>
		Effect.gen(function* () {
			// "1.0" is legal for an unpublished root and rejected by every decode
			// in this package; the mutator must carry it anyway, or the tool
			// refuses the repos it exists to edit.
			const source = '{\n  "version": "1.0",\n  "packageManager": "pnpm@11.2.0"\n}\n';
			const output = yield* PackageJsonFormat.modifyToString(source, ["packageManager"], "pnpm@11.3.0");
			assert.strictEqual(output, '{\n  "version": "1.0",\n  "packageManager": "pnpm@11.3.0"\n}\n');
		}),
	);

	it.effect("fails with PackageJsonSyntaxError on invalid JSON", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(PackageJsonFormat.modifyToString("{ nope", ["a"], 1));
			if (!(error instanceof PackageJsonSyntaxError)) {
				return assert.fail(`expected PackageJsonSyntaxError, got ${error._tag}`);
			}
			assert.strictEqual(error.reason, "invalid-json");
		}),
	);

	it.effect("fails with PackageJsonSyntaxError on a non-object document", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(PackageJsonFormat.modifyToString("[1, 2]", ["a"], 1));
			if (!(error instanceof PackageJsonSyntaxError)) {
				return assert.fail(`expected PackageJsonSyntaxError, got ${error._tag}`);
			}
			assert.strictEqual(error.reason, "not-an-object");
		}),
	);

	it.effect("fails with PackageJsonModifyError when the path cannot be navigated", () =>
		Effect.gen(function* () {
			// `name` is a string; descending into it as an object is a mismatch.
			const error = yield* Effect.flip(PackageJsonFormat.modifyToString(UNSORTED, ["name", "sub"], 1));
			if (!(error instanceof PackageJsonModifyError)) {
				return assert.fail(`expected PackageJsonModifyError, got ${error._tag}`);
			}
			assert.deepStrictEqual(error.path, ["name", "sub"]);
			// The structured cause is the underlying JsoncModificationError.
			assert.strictEqual((error.cause as { readonly _tag?: string })._tag, "JsoncModificationError");
		}),
	);
});

describe("PackageJsonFormat.modify", () => {
	it.effect("returns no edits for a structural no-op", () =>
		Effect.gen(function* () {
			// Deleting a key that does not exist is a no-op, not an error.
			const edits = yield* PackageJsonFormat.modify(UNSORTED, ["doesNotExist"], undefined);
			assert.strictEqual(edits.length, 0);
		}),
	);

	it.effect("computes a single-span edit for a value replacement", () =>
		Effect.gen(function* () {
			const edits = yield* PackageJsonFormat.modify(UNSORTED, ["packageManager"], "pnpm@11.3.0");
			assert.strictEqual(edits.length, 1);
			const edit = edits[0];
			if (edit === undefined) {
				return assert.fail("expected exactly one edit");
			}
			assert.strictEqual(edit.content, '"pnpm@11.3.0"');
			assert.strictEqual(UNSORTED.slice(edit.offset, edit.offset + edit.length), '"pnpm@11.2.0"');
		}),
	);
});

// Serialization failures: since @effected/jsonc's modify reports an
// unserializable value as JsoncStringifyError (it used to die), the package
// absorbs it into its own PackageJsonModifyError rather than letting a jsonc
// tag leak into its channel.
describe("PackageJsonFormat.modify serialization failures", () => {
	const modifyFailure = (value: unknown, path: ReadonlyArray<string> = ["extra"]) =>
		Effect.flip(PackageJsonFormat.modify(UNSORTED, path, value));

	it.effect("fails PackageJsonModifyError carrying a BigIntValue JsoncStringifyError for a bigint", () =>
		Effect.gen(function* () {
			const error = yield* modifyFailure(10n);
			if (!(error instanceof PackageJsonModifyError)) {
				return assert.fail(`expected PackageJsonModifyError, got ${error._tag}`);
			}
			assert.deepStrictEqual(error.path, ["extra"]);
			const cause = error.cause as { readonly _tag?: string; readonly code?: string };
			assert.strictEqual(cause._tag, "JsoncStringifyError");
			assert.strictEqual(cause.code, "BigIntValue");
			// The message names the path and appends the jsonc detail.
			assert.isTrue(error.message.startsWith("Failed to modify package.json at path [extra]: "), error.message);
			assert.include(error.message, "BigIntValue");
		}),
	);

	it.effect("fails PackageJsonModifyError for a circular value at an existing key", () =>
		Effect.gen(function* () {
			const circular: Record<string, unknown> = {};
			circular.self = circular;
			const error = yield* modifyFailure(circular, ["name"]);
			if (!(error instanceof PackageJsonModifyError)) {
				return assert.fail(`expected PackageJsonModifyError, got ${error._tag}`);
			}
			assert.strictEqual((error.cause as { readonly code?: string }).code, "CircularReference");
		}),
	);

	it.effect("reports the navigation cause when the path is also unnavigable", () =>
		Effect.gen(function* () {
			// `name` is a string, so ["name", "sub"] cannot be navigated; the
			// bigint is never serialized.
			const error = yield* modifyFailure(10n, ["name", "sub"]);
			if (!(error instanceof PackageJsonModifyError)) {
				return assert.fail(`expected PackageJsonModifyError, got ${error._tag}`);
			}
			assert.strictEqual((error.cause as { readonly _tag?: string })._tag, "JsoncModificationError");
		}),
	);
});

// The sync primitives the Effect forms are derived from. Parity is asserted
// per outcome — success, syntax failure, modify failure — against the Effect
// form, plus the applied text against modifyToString.
describe("PackageJsonFormat modify Result twins", () => {
	it.effect("modifyResult and modify agree on the edits", () =>
		Effect.gen(function* () {
			const result = PackageJsonFormat.modifyResult(UNSORTED, ["packageManager"], "pnpm@11.3.0");
			if (Result.isFailure(result)) return assert.fail("expected modifyResult to succeed");
			const edits = yield* PackageJsonFormat.modify(UNSORTED, ["packageManager"], "pnpm@11.3.0");
			assert.deepStrictEqual(result.success, edits);
		}),
	);

	it.effect("modifyToStringResult and modifyToString agree on the text", () =>
		Effect.gen(function* () {
			const result = PackageJsonFormat.modifyToStringResult(UNSORTED, ["scripts", "c"], "three");
			if (Result.isFailure(result)) return assert.fail("expected modifyToStringResult to succeed");
			assert.strictEqual(result.success, yield* PackageJsonFormat.modifyToString(UNSORTED, ["scripts", "c"], "three"));
			assert.include(result.success, '"c": "three"');
		}),
	);

	it("modifyToStringResult fails PackageJsonSyntaxError for a non-object source", () => {
		const result = PackageJsonFormat.modifyToStringResult("[]", ["name"], "p");
		if (Result.isSuccess(result)) return assert.fail("expected a non-object source to fail");
		assert.instanceOf(result.failure, PackageJsonSyntaxError);
	});

	it("modifyResult fails PackageJsonModifyError for a bigint, without throwing", () => {
		const result = PackageJsonFormat.modifyResult(UNSORTED, ["extra"], 1n);
		if (Result.isSuccess(result)) return assert.fail("expected a bigint value to fail");
		assert.instanceOf(result.failure, PackageJsonModifyError);
	});
});
