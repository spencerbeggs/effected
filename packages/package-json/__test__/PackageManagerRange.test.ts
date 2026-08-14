// The range-tolerant `packageManager` field: `<name>@<range>[+<integrity>]`.
//
// The class exists so the presence-lenient `PackageManifest` can read the
// range spelling (`pnpm@^11.20.0`) pnpm accepts, without weakening the strict
// `PackageManager` — whose continued rejection of ranges is pinned here as a
// control.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { PackageManager } from "../src/PackageManager.js";
import { PackageManagerRange } from "../src/PackageManagerRange.js";

const decode = Schema.decodeUnknownEffect(PackageManagerRange.FromString);
const encode = Schema.encodeUnknownEffect(PackageManagerRange.FromString);
const decodeStrict = Schema.decodeUnknownEffect(PackageManager.FromString);

describe("PackageManagerRange.FromString", () => {
	it.effect("parses a caret range and reports it inexact", () =>
		Effect.gen(function* () {
			const pm = yield* decode("pnpm@^11.20.0");
			assert.strictEqual(pm.name, "pnpm");
			assert.strictEqual(pm.range, "^11.20.0");
			assert.isFalse(pm.isExact);
			assert.isFalse(pm.hasIntegrity);
		}),
	);

	it.effect("parses an exact version and reports it exact", () =>
		Effect.gen(function* () {
			const pm = yield* decode("pnpm@11.2.0");
			assert.strictEqual(pm.range, "11.2.0");
			assert.isTrue(pm.isExact);
		}),
	);

	// `=11.2.0` names a single version but is a RANGE spelling — exactness
	// tracks the spelling the manifest carried, not the set it denotes, because
	// a consumer re-emitting the field must reproduce the spelling.
	it.effect("reports a range spelling of a single version as inexact", () =>
		Effect.gen(function* () {
			const pm = yield* decode("pnpm@=11.2.0");
			assert.isFalse(pm.isExact);
		}),
	);

	it.effect("parses an integrity suffix", () =>
		Effect.gen(function* () {
			const pm = yield* decode("pnpm@11.2.0+sha512.abc");
			assert.deepStrictEqual(pm.integrity, Option.some("sha512.abc"));
			assert.isTrue(pm.hasIntegrity);
		}),
	);

	it.effect("round-trips encode(decode) byte-identically", () =>
		Effect.gen(function* () {
			for (const input of ["pnpm@^11.20.0", "pnpm@11.2.0", "yarn@>=4 <5", "bun@1.2.x", "npm@11.2.0+sha512.abc"]) {
				const pm = yield* decode(input);
				assert.strictEqual(yield* encode(pm), input);
			}
		}),
	);

	it.effect("rejects a version position that is not a semver range", () =>
		Effect.gen(function* () {
			for (const input of ["pnpm@garbage", "not-a-pm", "PNPM@11.2.0", "pnpm@11.2.0+GARBAGE!!"]) {
				const error = yield* Effect.flip(decode(input));
				assert.strictEqual(error._tag, "SchemaError");
			}
		}),
	);

	// node-semver coerces an empty range string to `*`; accepting `pnpm@` on
	// those terms would be a silent edit, so it is a typed format failure.
	it.effect("rejects an empty version position rather than coercing it to *", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(decode("pnpm@"));
			assert.strictEqual(error._tag, "SchemaError");
		}),
	);

	// The control: the strict PackageManager is unchanged — the range spelling
	// still fails there, so nothing was silently loosened.
	it.effect("strict PackageManager.FromString still rejects the range spelling", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(decodeStrict("pnpm@^11.20.0"));
			assert.strictEqual(error._tag, "SchemaError");
		}),
	);
});
