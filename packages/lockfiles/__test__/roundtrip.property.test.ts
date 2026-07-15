// Codec round-trips: the model is API for serialization consumers (workspaces
// snapshots), so encode∘decode identity is contract, not incidental.
//
// The `integrity` and `specifier` leaves are NOT schema-derivable as
// arbitraries (probed against effect@4.0.0-beta.97):
//   - `ResolvedPackage.integrity` is the `@effected/npm` `IntegrityHash` brand,
//     a regex-filtered string. `Schema.toArbitrary` over it *hangs* — fast-check
//     rejects ~every random string against the SRI grammar.
//   - `ImporterDependency.specifier` is the `DependencySpecifier.FromString`
//     codec. Its Type is a union of tagged classes carrying a free-form `raw`,
//     so a schema-derived arbitrary generates tag/raw mismatches whose
//     encode∘decode does *not* round-trip (the codec re-classifies `raw`).
// So these leaves use explicit `FastCheck.constantFrom` arbitraries of real
// values — the same pattern `@effected/npm`'s own DependencySpecifier round-trip
// suite uses. The plain-union fields (`WorkspaceDependency`, `LockfileIntegrity`)
// stay schema-derived, which works.

import { assert, describe, it } from "@effect/vitest";
import type { IntegrityHashBrand } from "@effected/npm";
import { DependencySpecifier } from "@effected/npm";
import { Effect, Schema } from "effect";
import * as FastCheck from "effect/testing/FastCheck";
import { ImporterDependency } from "../src/ImporterDependency.js";
import { Lockfile } from "../src/Lockfile.js";
import { LockfileImporter } from "../src/LockfileImporter.js";
import { LockfileIntegrity } from "../src/LockfileIntegrity.js";
import { ResolvedPackage } from "../src/ResolvedPackage.js";
import { WorkspaceDependency } from "../src/WorkspaceDependency.js";

const roundTrip = <T, S extends Schema.Codec<T, unknown>>(schema: S, value: T) =>
	Effect.gen(function* () {
		const encoded = yield* Schema.encodeUnknownEffect(schema)(value);
		const decoded = yield* Schema.decodeUnknownEffect(schema)(encoded);
		assert.deepStrictEqual(decoded, value);
	});

// ── Explicit arbitraries for the non-schema-derivable leaves ─────────────────

const integrityArb: FastCheck.Arbitrary<IntegrityHashBrand> = FastCheck.constantFrom(
	"sha512-LgVTMpQtIopCi79SJeDiP0TfWi5CNEc/L/aRdTh3yIvmZXTnheWpKjSZhnvMl8iXbC1tFg9gdHHDMLoV7CnG+w==",
	"sha1-Zm9vYmFy",
	"sha256-YWJjZGVmZ2g=",
	"sha512.deadbeefcafe",
	"10c0/99a4b0f0e7991796b1e7e3f52dceb9137cae2a9dfc8fc0784a550dc4c558e15a",
).map((s) => s as IntegrityHashBrand);

const specifierArb = FastCheck.constantFrom(
	"catalog:",
	"catalog:react18",
	"workspace:*",
	"workspace:^1.2.3",
	"^1.0.0",
	"1.2.3",
	"latest",
	"file:../local",
	"npm:lodash@^4.0.0",
).map((s) => Schema.decodeUnknownSync(DependencySpecifier.FromString)(s));

const depField = FastCheck.constantFrom("dependencies", "devDependencies", "peerDependencies", "optionalDependencies");

const importerDependencyArb: FastCheck.Arbitrary<ImporterDependency> = FastCheck.record({
	name: FastCheck.constantFrom("lodash", "chalk", "@scope/x", "typescript"),
	specifier: specifierArb,
	depType: depField,
	version: FastCheck.option(FastCheck.constantFrom("1.0.0", "5.9.3"), { nil: undefined }),
}).map(({ name, specifier, depType, version }) =>
	ImporterDependency.make({ name, specifier, depType, ...(version !== undefined ? { version } : {}) }),
);

const lockfileImporterArb: FastCheck.Arbitrary<LockfileImporter> = FastCheck.record({
	path: FastCheck.constantFrom(".", "packages/core", "packages/utils"),
	dependencies: FastCheck.array(importerDependencyArb, { maxLength: 3 }),
}).map((r) => LockfileImporter.make(r));

const resolvedPackageArb: FastCheck.Arbitrary<ResolvedPackage> = FastCheck.record({
	name: FastCheck.constantFrom("lodash", "chalk", "packages/core", "@scope/x"),
	version: FastCheck.constantFrom("1.0.0", "0.0.0", "5.6.2"),
	integrity: FastCheck.option(integrityArb, { nil: undefined }),
	isWorkspace: FastCheck.boolean(),
	relativePath: FastCheck.option(FastCheck.constantFrom("packages/core", "packages/utils"), { nil: undefined }),
	dependencies: FastCheck.dictionary(FastCheck.constantFrom("a", "b"), FastCheck.constantFrom("^1.0.0", "2.x")),
}).map((r) =>
	ResolvedPackage.make({
		name: r.name,
		version: r.version,
		isWorkspace: r.isWorkspace,
		dependencies: r.dependencies,
		...(r.integrity !== undefined ? { integrity: r.integrity } : {}),
		...(r.relativePath !== undefined ? { relativePath: r.relativePath } : {}),
	}),
);

const lockfileArb: FastCheck.Arbitrary<Lockfile> = FastCheck.record({
	format: FastCheck.constantFrom("bun", "npm", "pnpm", "yarn"),
	lockfileVersion: FastCheck.constantFrom("9.0", "6.0", "3"),
	packages: FastCheck.array(resolvedPackageArb, { maxLength: 4 }),
	workspaceDependencies: FastCheck.array(Schema.toArbitrary(WorkspaceDependency), { maxLength: 3 }),
	importers: FastCheck.array(lockfileImporterArb, { maxLength: 3 }),
}).map((r) => Lockfile.make(r));

describe("codec round-trips", () => {
	it.effect.prop("ResolvedPackage: decode ∘ encode is identity", [resolvedPackageArb], ([pkg]) =>
		roundTrip(ResolvedPackage, pkg),
	);

	it.effect.prop("WorkspaceDependency: decode ∘ encode is identity", [WorkspaceDependency], ([dep]) =>
		roundTrip(WorkspaceDependency, dep),
	);

	it.effect.prop("ImporterDependency: decode ∘ encode is identity", [importerDependencyArb], ([dep]) =>
		roundTrip(ImporterDependency, dep),
	);

	it.effect.prop("LockfileImporter: decode ∘ encode is identity", [lockfileImporterArb], ([importer]) =>
		roundTrip(LockfileImporter, importer),
	);

	it.effect.prop("Lockfile (with importers): decode ∘ encode is identity", [lockfileArb], ([lockfile]) =>
		roundTrip(Lockfile, lockfile),
	);

	it.effect.prop("LockfileIntegrity: decode ∘ encode is identity", [LockfileIntegrity], ([report]) =>
		roundTrip(LockfileIntegrity, report),
	);

	it.effect("a parsed fixture-shaped lockfile survives encode ∘ decode", () =>
		Effect.gen(function* () {
			const lockfile = Lockfile.make({
				format: "pnpm",
				lockfileVersion: "9.0",
				packages: [
					ResolvedPackage.make({
						name: "packages/core",
						version: "0.0.0",
						isWorkspace: true,
						relativePath: "packages/core",
					}),
					ResolvedPackage.make({
						name: "chalk",
						version: "5.6.2",
						integrity: "sha512-abc" as IntegrityHashBrand,
						isWorkspace: false,
						dependencies: { "supports-color": "^9.0.0" },
					}),
				],
				workspaceDependencies: [
					WorkspaceDependency.make({
						from: "packages/core",
						to: "@acme/utils",
						depType: "dependencies",
						constraint: "workspace:*",
					}),
				],
				importers: [
					LockfileImporter.make({
						path: "packages/core",
						dependencies: [
							ImporterDependency.make({
								name: "lodash",
								specifier: Schema.decodeUnknownSync(DependencySpecifier.FromString)("catalog:"),
								version: "4.17.23",
								depType: "dependencies",
							}),
						],
					}),
				],
			});
			yield* roundTrip(Lockfile, lockfile);
		}),
	);
});
