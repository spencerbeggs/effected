// Document framing: a lockfile file is a YAML *stream*, not necessarily a
// single document. pnpm 11 writes a config-dependencies ("env") preamble
// document ahead of the lockfile whenever the workspace uses
// `configDependencies` — the effected repo's own pnpm-lock.yaml is exactly
// that shape.
//
// Both documents declare lockfileVersion, importers and packages, so the
// preamble *validates* against the pnpm schema. A single-document parse
// therefore succeeded and handed back a Lockfile describing an empty
// workspace: the worst failure shape there is, because it looks like an
// answer. These tests pin the deterministic framing rule (the lockfile is the
// last document — pnpm composes the preamble as a prefix) and prove that an
// unlocatable lockfile now fails typed instead of returning an empty model.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Lockfile, LockfileFramingError, LockfileParseError } from "../src/Lockfile.js";
import type { LockfileFormat } from "../src/LockfileFormat.js";

const fixture = (relative: string): string => readFileSync(join(import.meta.dirname, "fixtures", relative), "utf8");

/** Flip a failing parse and hand back the typed framing error. */
const framingError = (content: string, format: LockfileFormat) =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(Lockfile.parse(content, { format }));
		assert.instanceOf(error, LockfileFramingError);
		assert.strictEqual(error.format, format);
		return error;
	});

/** A pnpm config-dependencies preamble document, verbatim in shape. */
const preamble = [
	"---",
	"lockfileVersion: '9.0'",
	"",
	"importers:",
	"",
	"  .:",
	"    configDependencies:",
	"      '@effected/pnpm-plugin-effect':",
	"        specifier: 0.1.0",
	"        version: 0.1.0",
	"",
	"packages:",
	"",
	"  '@effected/pnpm-plugin-effect@0.1.0':",
	"    resolution: {integrity: sha512-abc}",
	"",
	"snapshots:",
	"",
	"  '@effected/pnpm-plugin-effect@0.1.0': {}",
	"",
].join("\n");

describe("document framing", () => {
	describe("pnpm: a two-document lockfile parses the lockfile, not the preamble", () => {
		it.effect("reads the real workspace out of the second document", () =>
			Effect.gen(function* () {
				const lockfile = yield* Lockfile.parse(fixture("pnpm/multidoc/pnpm-lock.yaml"), { format: "pnpm" });

				// The preamble also declares lockfileVersion/importers/packages, so
				// these assertions are what tell the two documents apart.
				assert.deepStrictEqual(
					lockfile.workspacePackages.map((p) => p.name),
					["packages/core", "packages/utils"],
				);
				assert.strictEqual(lockfile.packages.length, 5);

				// The decisive one: the preamble's config-dependency package must NOT
				// appear. Before the fix this was the *only* package in the model.
				assert.deepStrictEqual(lockfile.packagesNamed("@effected/pnpm-plugin-effect"), []);

				const chalk = lockfile.packagesNamed("chalk");
				assert.strictEqual(chalk.length, 1);
				assert.strictEqual(chalk[0]?.version, "5.6.2");
			}),
		);

		it.effect("carries the second document's catalogs, overrides and settings", () =>
			Effect.gen(function* () {
				const lockfile = yield* Lockfile.parse(fixture("pnpm/multidoc/pnpm-lock.yaml"), { format: "pnpm" });

				assert.strictEqual(lockfile.extension?._tag, "pnpm");
				if (lockfile.extension?._tag === "pnpm") {
					// The preamble has no catalogs at all — 0 catalogs was a symptom.
					assert.deepStrictEqual(lockfile.extension.catalogs?.effect, {
						effect: { specifier: "4.0.0-beta.94", version: "4.0.0-beta.94" },
					});
					assert.deepStrictEqual(lockfile.extension.overrides, { lodash: "4.17.21" });
					assert.strictEqual(lockfile.extension.settings?.autoInstallPeers, true);
				}
			}),
		);

		it.effect("resolves workspace dependency edges from the second document", () =>
			Effect.gen(function* () {
				const lockfile = yield* Lockfile.parse(fixture("pnpm/multidoc/pnpm-lock.yaml"), { format: "pnpm" });

				assert.strictEqual(lockfile.workspaceDependencies.length, 1);
				const edge = lockfile.workspaceDependencies[0];
				assert.strictEqual(edge?.from, "packages/core");
				assert.strictEqual(edge?.to, "@test-monorepo/utils");
				assert.strictEqual(edge?.constraint, "workspace:*");
			}),
		);
	});

	describe("pnpm: single-document lockfiles are unaffected", () => {
		it.effect("v1 still parses (no regression from stream parsing)", () =>
			Effect.gen(function* () {
				const lockfile = yield* Lockfile.parse(fixture("pnpm/v1/pnpm-lock.yaml"), { format: "pnpm" });

				assert.strictEqual(lockfile.packages.length, 5);
				assert.deepStrictEqual(
					lockfile.workspacePackages.map((p) => p.name),
					["packages/core", "packages/utils"],
				);
			}),
		);

		it.effect("a lone document carrying a leading '---' marker is still the lockfile", () =>
			Effect.gen(function* () {
				// pnpm's own byte-level reader keys off a leading "---" and would call
				// this env-only. Selecting by document position rather than by prefix
				// byte keeps a normalized single-document lockfile readable.
				const content = `---\n${fixture("pnpm/v1/pnpm-lock.yaml")}`;
				const lockfile = yield* Lockfile.parse(content, { format: "pnpm" });

				assert.strictEqual(lockfile.packages.length, 5);
			}),
		);
	});

	describe("pnpm: an unlocatable lockfile fails typed, never as an empty model", () => {
		it.effect("an env-only lockfile (preamble, empty main document) fails 'noLockfileDocument'", () =>
			Effect.gen(function* () {
				// Exactly what pnpm's writeEnvLockfile produces when there is no main
				// lockfile yet: `---` env `---` and nothing after it. pnpm itself reads
				// this as "no lockfile"; so must we — never by falling back to the
				// preamble, which would report a one-package, zero-workspace repo.
				const error = yield* framingError(`${preamble}\n---\n`, "pnpm");

				assert.strictEqual(error.reason, "noLockfileDocument");
				assert.strictEqual(error.documents, 2);
			}),
		);

		it.effect("empty content fails 'noLockfileDocument'", () =>
			Effect.gen(function* () {
				const error = yield* framingError("", "pnpm");
				assert.strictEqual(error.reason, "noLockfileDocument");
			}),
		);

		it.effect("a lockfile document declaring no importers fails 'noImporters'", () =>
			Effect.gen(function* () {
				// pnpm always records at least the root importer ".", so an empty
				// importers map describes no workspace. Failing typed here is what
				// keeps "empty workspace" from ever being a successful answer.
				const error = yield* framingError("lockfileVersion: '9.0'\nimporters: {}\n", "pnpm");

				assert.strictEqual(error.reason, "noImporters");
			}),
		);

		it.effect("the framing failure is not reported as a LockfileParseError", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Lockfile.parse(`${preamble}\n---\n`, { format: "pnpm" }));

				assert.instanceOf(error, LockfileFramingError);
				assert.isFalse(error instanceof LockfileParseError);
				assert.strictEqual(error._tag, "LockfileFramingError");
			}),
		);
	});

	describe("yarn: no document framing means multi-document input is refused, not truncated", () => {
		const berry = ["__metadata:\n  version: 8\n", '"a@npm:^1.0.0":\n  version: 1.0.0\n  linkType: hard\n'].join("");

		it.effect("a multi-document yarn.lock fails 'unexpectedDocuments'", () =>
			Effect.gen(function* () {
				const error = yield* framingError(`${berry}---\n${berry}`, "yarn");

				assert.strictEqual(error.reason, "unexpectedDocuments");
				assert.strictEqual(error.documents, 2);
			}),
		);

		it.effect("a single-document yarn.lock still parses", () =>
			Effect.gen(function* () {
				const lockfile = yield* Lockfile.parse(berry, { format: "yarn" });

				assert.strictEqual(lockfile.format, "yarn");
				assert.strictEqual(lockfile.lockfileVersion, "8");
			}),
		);
	});

	describe("npm and bun define no document framing and never shared the assumption", () => {
		// JSON and JSONC are single-value by construction: a second top-level
		// value is a syntax error, not a silently-ignored second document. These
		// pin that, so the formats' framing posture is asserted rather than
		// assumed.
		it.effect("npm: a second JSON value is a syntax error", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Lockfile.parse('{"lockfileVersion":3}\n{"a":1}', { format: "npm" }));

				assert.instanceOf(error, LockfileParseError);
				assert.strictEqual(error.stage, "syntax");
			}),
		);

		it.effect("bun: a second JSONC value is a syntax error", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Lockfile.parse('{"lockfileVersion":1}\n{"a":1}', { format: "bun" }));

				assert.instanceOf(error, LockfileParseError);
				assert.strictEqual(error.stage, "syntax");
			}),
		);
	});
});
