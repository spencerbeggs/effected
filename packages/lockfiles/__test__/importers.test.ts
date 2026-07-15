// Per-format importer extraction: the `Lockfile.importers` field and the
// `lockfile.importer(path)` keyed lookup. pnpm records `{ specifier, version }`
// per importer dependency; bun and npm record a specifier only (the resolved
// version lives on package entries); yarn records no importers at all.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Lockfile } from "../src/Lockfile.js";
import type { LockfileFormat } from "../src/LockfileFormat.js";

const fixture = (relative: string): string => readFileSync(join(import.meta.dirname, "fixtures", relative), "utf8");
const parseFixture = (relative: string, format: LockfileFormat) => Lockfile.parse(fixture(relative), { format });

describe("Lockfile.importers", () => {
	describe("pnpm", () => {
		it.effect("v1: importer dependencies carry both specifier and version", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("pnpm/v1/pnpm-lock.yaml", "pnpm");

				// The root importer "." is present and declares nothing.
				const root = lockfile.importer(".");
				assert.isTrue(Option.isSome(root));
				assert.strictEqual(Option.getOrThrow(root).dependencies.length, 0);

				const core = Option.getOrThrow(lockfile.importer("packages/core"));
				assert.strictEqual(core.path, "packages/core");
				// dependencies (2) + devDependencies (1)
				assert.strictEqual(core.dependencies.length, 3);

				const lodash = core.dependencies.find((d) => d.name === "lodash");
				assert.strictEqual(lodash?.specifier.raw, "4.17.21");
				assert.strictEqual(lodash?.specifier._tag, "range");
				assert.strictEqual(lodash?.version, "4.17.21");
				assert.strictEqual(lodash?.depType, "dependencies");

				const utils = core.dependencies.find((d) => d.name === "@test-monorepo/utils");
				assert.strictEqual(utils?.specifier.raw, "workspace:*");
				assert.strictEqual(utils?.specifier._tag, "workspace");
				assert.strictEqual(utils?.version, "link:../utils");

				const ts = core.dependencies.find((d) => d.name === "typescript");
				assert.strictEqual(ts?.depType, "devDependencies");
				assert.strictEqual(ts?.version, "5.9.3");
			}),
		);

		it.effect("v3: a `catalog:` specifier classifies as catalog and round-trips its raw", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("pnpm/v3/pnpm-lock.yaml", "pnpm");
				const core = Option.getOrThrow(lockfile.importer("packages/core"));
				const lodash = core.dependencies.find((d) => d.name === "lodash");
				assert.strictEqual(lodash?.specifier._tag, "catalog");
				assert.strictEqual(lodash?.specifier.raw, "catalog:");
				assert.strictEqual(lodash?.version, "4.17.23");
			}),
		);
	});

	describe("bun", () => {
		it.effect("v1: importer dependencies carry a specifier and no version", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("bun/v1/bun.lock", "bun");

				// The root workspace ("") becomes the "." importer.
				const root = Option.getOrThrow(lockfile.importer("."));
				assert.strictEqual(root.dependencies.length, 0);

				const core = Option.getOrThrow(lockfile.importer("packages/core"));
				// 3 dependencies + 1 devDependency
				assert.strictEqual(core.dependencies.length, 4);
				assert.isTrue(core.dependencies.every((d) => d.version === undefined));

				const react = core.dependencies.find((d) => d.name === "react");
				assert.strictEqual(react?.specifier._tag, "catalog");
				assert.strictEqual(react?.specifier.raw, "catalog:");
			}),
		);
	});

	describe("npm", () => {
		it.effect("v2: root and workspace importers carry a specifier and no version", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("npm/v2/package-lock.json", "npm");

				const root = Option.getOrThrow(lockfile.importer("."));
				const ts = root.dependencies.find((d) => d.name === "typescript");
				assert.strictEqual(ts?.depType, "devDependencies");
				assert.strictEqual(ts?.specifier.raw, "^5.3.0");
				assert.strictEqual(ts?.version, undefined);

				// 3 dependencies + 1 peerDependency + 1 optionalDependency.
				const core = Option.getOrThrow(lockfile.importer("packages/core"));
				assert.strictEqual(core.dependencies.length, 5);
				assert.isTrue(core.dependencies.every((d) => d.version === undefined));
				assert.strictEqual(core.dependencies.find((d) => d.name === "react")?.depType, "peerDependencies");
				assert.strictEqual(core.dependencies.find((d) => d.name === "fsevents")?.depType, "optionalDependencies");
			}),
		);
	});

	describe("yarn", () => {
		it.effect("v1: records no importers", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("yarn/v1/yarn.lock", "yarn");
				assert.strictEqual(lockfile.importers.length, 0);
				assert.isTrue(Option.isNone(lockfile.importer(".")));
			}),
		);
	});

	it.effect("importer(path) is None for an unknown path", () =>
		Effect.gen(function* () {
			const lockfile = yield* parseFixture("pnpm/v1/pnpm-lock.yaml", "pnpm");
			assert.isTrue(Option.isNone(lockfile.importer("packages/does-not-exist")));
		}),
	);
});
