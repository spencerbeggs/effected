// Lockfile.parse with configOnly over an env preamble and an empty main
// document: the preamble is read through @effected/pnpm's PnpmEnvDocument.parse,
// which decodes its whole shape, not only its lockfileVersion. A preamble
// PnpmEnvLockfile would reject is rejected here too, so the two readers agree
// about which preambles are well formed.

import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Lockfile, LockfileParseError } from "../src/Lockfile.js";
import { PnpmEnvLockfile } from "../src/PnpmEnvLockfile.js";

const configOnly = { format: "pnpm", configOnly: true } as const;

/** A preamble whose config dependency is a bare string, not `{ specifier, version }`, then an empty main document. */
const malformedPreamble = "lockfileVersion: '9.0'\nimporters:\n  .:\n    configDependencies:\n      foo: 1.0.0\n---\n";

/** The same preamble, well formed, then an empty main document. */
const wellFormedPreamble = [
	"lockfileVersion: '9.0'",
	"importers:",
	"  .:",
	"    configDependencies:",
	"      foo:",
	"        specifier: 1.0.0",
	"        version: 1.0.0",
	"---",
	"",
].join("\n");

describe("Lockfile.parse configOnly reads the preamble's whole shape", () => {
	it.effect("a well-formed preamble before an empty main document reads as an empty lockfile", () =>
		Effect.gen(function* () {
			const lockfile = yield* Lockfile.parse(wellFormedPreamble, configOnly);
			assert.strictEqual(lockfile.lockfileVersion, "9.0");
			assert.lengthOf(lockfile.packages, 0);
			assert.lengthOf(lockfile.importers, 0);
		}),
	);

	it.effect("a preamble with a malformed shape fails at stage 'validation'", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Lockfile.parse(malformedPreamble, configOnly));
			assert.instanceOf(error, LockfileParseError);
			if (!(error instanceof LockfileParseError)) return;
			assert.strictEqual(error.stage, "validation");
		}),
	);

	it.effect("control: PnpmEnvLockfile rejects the same preamble the same way", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(PnpmEnvLockfile.configDependencies(malformedPreamble));
			assert.instanceOf(error, LockfileParseError);
			if (!(error instanceof LockfileParseError)) return;
			assert.strictEqual(error.stage, "validation");
		}),
	);
});
