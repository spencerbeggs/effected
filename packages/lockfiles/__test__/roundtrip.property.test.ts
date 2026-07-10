// Codec round-trips: the model is API for serialization consumers
// (workspaces snapshots), so encode∘decode identity is contract, not
// incidental. Arbitraries derive from the schemas via Schema.toArbitrary
// (it.effect.prop array form — the named-record form silently discards
// Schema conversion in @effect/vitest 4.0.0-beta.94).

import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Lockfile } from "../src/Lockfile.js";
import { LockfileIntegrity } from "../src/LockfileIntegrity.js";
import { ResolvedPackage } from "../src/ResolvedPackage.js";
import { WorkspaceDependency } from "../src/WorkspaceDependency.js";

const roundTrip = <T, S extends Schema.Codec<T, unknown>>(schema: S, value: T) =>
	Effect.gen(function* () {
		const encoded = yield* Schema.encodeUnknownEffect(schema)(value);
		const decoded = yield* Schema.decodeUnknownEffect(schema)(encoded);
		assert.deepStrictEqual(decoded, value);
	});

describe("codec round-trips", () => {
	it.effect.prop("ResolvedPackage: decode ∘ encode is identity", [ResolvedPackage], ([pkg]) =>
		roundTrip(ResolvedPackage, pkg),
	);

	it.effect.prop("WorkspaceDependency: decode ∘ encode is identity", [WorkspaceDependency], ([dep]) =>
		roundTrip(WorkspaceDependency, dep),
	);

	it.effect.prop("Lockfile: decode ∘ encode is identity", [Lockfile], ([lockfile]) => roundTrip(Lockfile, lockfile));

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
						integrity: "sha512-abc",
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
			});
			yield* roundTrip(Lockfile, lockfile);
		}),
	);
});
