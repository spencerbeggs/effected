// Per-format fixture tests: the ported corpus (pnpm v1–v3, npm v1–v2,
// yarn v1–v2, bun v1–v3) asserted against the unified model — package
// counts, workspace identification, integrity hashes, workspace dependency
// edges and extension payloads — plus the model's own instance surface
// (packagesNamed, workspacePackages) and the withImporterNames seam repair.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Lockfile } from "../src/Lockfile.js";
import type { LockfileFormat } from "../src/LockfileFormat.js";

const fixture = (relative: string): string => readFileSync(join(import.meta.dirname, "fixtures", relative), "utf8");

const parseFixture = (relative: string, format: LockfileFormat) => Lockfile.parse(fixture(relative), { format });

describe("Lockfile.parse", () => {
	describe("pnpm", () => {
		it.effect("v1: normalizes importers, packages, edges and the pnpm extension", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("pnpm/v1/pnpm-lock.yaml", "pnpm");

				assert.strictEqual(lockfile.format, "pnpm");
				assert.strictEqual(lockfile.lockfileVersion, "9.0");
				assert.strictEqual(lockfile.packages.length, 5);

				// Workspace packages are importer-path-keyed with version "0.0.0" —
				// the honest first stage; withImporterNames is the second.
				const workspaces = lockfile.workspacePackages;
				assert.deepStrictEqual(
					workspaces.map((p) => p.name),
					["packages/core", "packages/utils"],
				);
				assert.isTrue(workspaces.every((p) => p.version === "0.0.0"));
				assert.isTrue(workspaces.every((p) => p.relativePath === p.name));

				const chalk = lockfile.packagesNamed("chalk");
				assert.strictEqual(chalk.length, 1);
				assert.strictEqual(chalk[0]?.version, "5.6.2");
				assert.isFalse(chalk[0]?.isWorkspace);
				assert.isTrue(chalk[0]?.integrity?.startsWith("sha512-"));

				assert.strictEqual(lockfile.workspaceDependencies.length, 1);
				const edge = lockfile.workspaceDependencies[0];
				assert.strictEqual(edge?.from, "packages/core");
				assert.strictEqual(edge?.to, "@test-monorepo/utils");
				assert.strictEqual(edge?.depType, "dependencies");
				assert.strictEqual(edge?.constraint, "workspace:*");

				assert.strictEqual(lockfile.extension?._tag, "pnpm");
				if (lockfile.extension?._tag === "pnpm") {
					assert.deepStrictEqual(lockfile.extension.catalogs?.default, {
						chalk: { specifier: "^5.3.0", version: "5.6.2" },
					});
					assert.deepStrictEqual(lockfile.extension.overrides, { lodash: "4.17.21" });
					assert.strictEqual(lockfile.extension.settings?.autoInstallPeers, true);
					assert.strictEqual(lockfile.extension.settings?.excludeLinksFromLockfile, false);
				}
			}),
		);

		it.effect("v2: carries named catalogs with specifier/version entries", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("pnpm/v2/pnpm-lock.yaml", "pnpm");

				assert.strictEqual(lockfile.format, "pnpm");
				assert.deepStrictEqual(
					lockfile.workspacePackages.map((p) => p.name),
					["packages/core", "packages/new-pkg", "packages/utils"],
				);

				const edges = lockfile.workspaceDependencies;
				assert.deepStrictEqual(
					edges.map((e) => [e.from, e.to]),
					[
						["packages/core", "@test-monorepo/utils"],
						["packages/new-pkg", "@test-monorepo/utils"],
					],
				);

				assert.strictEqual(lockfile.extension?._tag, "pnpm");
				if (lockfile.extension?._tag === "pnpm") {
					const silk = lockfile.extension.catalogs?.silk;
					assert.isDefined(silk);
					for (const entry of Object.values(silk ?? {})) {
						assert.isObject(entry);
						assert.property(entry, "specifier");
						assert.property(entry, "version");
					}
				}
			}),
		);

		it.effect("v3: parses the minimal modern lockfile", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("pnpm/v3/pnpm-lock.yaml", "pnpm");

				assert.strictEqual(lockfile.packages.length, 4);
				assert.strictEqual(lockfile.workspacePackages.length, 2);
				assert.strictEqual(lockfile.workspaceDependencies.length, 1);
				assert.strictEqual(lockfile.packagesNamed("lodash")[0]?.version, "4.17.23");
				assert.strictEqual(lockfile.extension?._tag, "pnpm");
			}),
		);
	});

	describe("npm", () => {
		it.effect("v1: resolves workspace links to real names and versions", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("npm/v1/package-lock.json", "npm");

				assert.strictEqual(lockfile.format, "npm");
				assert.strictEqual(lockfile.lockfileVersion, "3");
				assert.strictEqual(lockfile.packages.length, 5);

				const workspaces = lockfile.workspacePackages;
				assert.deepStrictEqual(
					workspaces.map((p) => [p.name, p.version, p.relativePath]),
					[
						["@test-monorepo/core", "1.0.0", "packages/core"],
						["@test-monorepo/utils", "1.0.0", "packages/utils"],
					],
				);

				assert.strictEqual(lockfile.packagesNamed("typescript")[0]?.version, "5.9.3");
				assert.isTrue(lockfile.packagesNamed("chalk")[0]?.integrity?.startsWith("sha512-"));

				assert.strictEqual(lockfile.workspaceDependencies.length, 1);
				const edge = lockfile.workspaceDependencies[0];
				assert.strictEqual(edge?.from, "@test-monorepo/core");
				assert.strictEqual(edge?.to, "@test-monorepo/utils");
				assert.strictEqual(edge?.constraint, "*");

				// npm records no format-specific extension.
				assert.isUndefined(lockfile.extension);
			}),
		);

		it.effect("v2: handles the three-workspace lockfile", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("npm/v2/package-lock.json", "npm");

				assert.deepStrictEqual(
					lockfile.workspacePackages.map((p) => p.name),
					["@test-monorepo/core", "@test-monorepo/new-pkg", "@test-monorepo/utils"],
				);
				// 104 registry packages + 3 workspaces.
				assert.strictEqual(lockfile.packages.length, 107);
				assert.deepStrictEqual(
					lockfile.workspaceDependencies.map((e) => [e.from, e.to]),
					[
						["@test-monorepo/core", "@test-monorepo/utils"],
						["@test-monorepo/new-pkg", "@test-monorepo/utils"],
					],
				);
			}),
		);
	});

	describe("yarn (Berry)", () => {
		it.effect("v1: identifies soft-link workspaces including the root", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("yarn/v1/yarn.lock", "yarn");

				assert.strictEqual(lockfile.format, "yarn");
				assert.strictEqual(lockfile.lockfileVersion, "8");
				assert.strictEqual(lockfile.packages.length, 7);

				const workspaces = lockfile.workspacePackages;
				assert.deepStrictEqual(workspaces.map((p) => p.name).sort(), [
					"@test-monorepo/core",
					"@test-monorepo/utils",
					"test-yarn-monorepo",
				]);
				assert.isTrue(workspaces.every((p) => p.version === "0.0.0-use.local"));

				// The compound key "@test-monorepo/utils@workspace:*, ...@workspace:packages/utils"
				// yields the non-* path.
				const utils = lockfile.packagesNamed("@test-monorepo/utils")[0];
				assert.strictEqual(utils?.relativePath, "packages/utils");

				// Berry checksums land as integrity.
				const chalk = lockfile.packagesNamed("chalk")[0];
				assert.strictEqual(chalk?.version, "5.6.2");
				assert.isTrue(chalk?.integrity?.startsWith("10c0/"));

				assert.strictEqual(lockfile.workspaceDependencies.length, 1);
				const edge = lockfile.workspaceDependencies[0];
				assert.strictEqual(edge?.from, "@test-monorepo/core");
				assert.strictEqual(edge?.to, "@test-monorepo/utils");
				assert.strictEqual(edge?.constraint, "workspace:*");

				assert.isUndefined(lockfile.extension);
			}),
		);

		it.effect("v2: extracts edges across three workspaces and strips npm: prefixes", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("yarn/v2/yarn.lock", "yarn");

				const workspaceNames = lockfile.workspacePackages.map((p) => p.name).sort();
				assert.deepStrictEqual(workspaceNames, [
					"@test-monorepo/core",
					"@test-monorepo/new-pkg",
					"@test-monorepo/utils",
					"test-yarn-monorepo",
				]);

				assert.deepStrictEqual(lockfile.workspaceDependencies.map((e) => [e.from, e.to]).sort(), [
					["@test-monorepo/core", "@test-monorepo/utils"],
					["@test-monorepo/new-pkg", "@test-monorepo/utils"],
				]);

				// typescript resolves through both @npm: and @patch: descriptors.
				assert.isAtLeast(lockfile.packagesNamed("typescript").length, 2);
			}),
		);
	});

	describe("bun", () => {
		it.effect("v1: reads workspaces, package tuples and the bun extension", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("bun/v1/bun.lock", "bun");

				assert.strictEqual(lockfile.format, "bun");
				assert.strictEqual(lockfile.lockfileVersion, "1");
				// 2 workspaces + 5 registry tuples (the workspace tuples are
				// deduplicated against the workspaces map).
				assert.strictEqual(lockfile.packages.length, 7);

				const workspaces = lockfile.workspacePackages;
				assert.deepStrictEqual(
					workspaces.map((p) => [p.name, p.version, p.relativePath]),
					[
						["@test-monorepo/core", "1.0.0", "packages/core"],
						["@test-monorepo/utils", "1.0.0", "packages/utils"],
					],
				);

				// Integrity is assumed at tuple index 3 (the pinned bun tuple shape).
				const chalk = lockfile.packagesNamed("chalk")[0];
				assert.strictEqual(chalk?.version, "5.6.2");
				assert.isTrue(chalk?.integrity?.startsWith("sha512-"));

				assert.strictEqual(lockfile.workspaceDependencies.length, 1);
				assert.strictEqual(lockfile.workspaceDependencies[0]?.from, "@test-monorepo/core");
				assert.strictEqual(lockfile.workspaceDependencies[0]?.to, "@test-monorepo/utils");

				assert.strictEqual(lockfile.extension?._tag, "bun");
				if (lockfile.extension?._tag === "bun") {
					assert.deepStrictEqual(lockfile.extension.catalog, { react: "^19.0.0", "react-dom": "^19.0.0" });
					assert.isUndefined(lockfile.extension.catalogs);
					assert.isUndefined(lockfile.extension.trustedDependencies);
				}
			}),
		);

		it.effect("v2: carries both the default catalog and named catalogs", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("bun/v2/bun.lock", "bun");

				assert.deepStrictEqual(
					lockfile.workspacePackages.map((p) => p.name),
					["@test-monorepo/core", "@test-monorepo/new-pkg", "@test-monorepo/utils"],
				);
				assert.deepStrictEqual(
					lockfile.workspaceDependencies.map((e) => [e.from, e.to]),
					[
						["@test-monorepo/core", "@test-monorepo/utils"],
						["@test-monorepo/new-pkg", "@test-monorepo/utils"],
					],
				);

				assert.strictEqual(lockfile.extension?._tag, "bun");
				if (lockfile.extension?._tag === "bun") {
					assert.deepStrictEqual(lockfile.extension.catalog, {
						react: "^19.1.0",
						"react-dom": "^19.1.0",
						zod: "^3.23.0",
					});
					assert.deepStrictEqual(lockfile.extension.catalogs, { testing: { vitest: "^3.0.0" } });
				}
			}),
		);

		it.effect("v3: parses the minimal lockfile", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("bun/v3/bun.lock", "bun");

				assert.strictEqual(lockfile.packages.length, 4);
				assert.strictEqual(lockfile.workspacePackages.length, 2);
				assert.strictEqual(lockfile.workspaceDependencies.length, 1);
				assert.strictEqual(lockfile.packagesNamed("react")[0]?.version, "19.2.4");
			}),
		);
	});
});

describe("Lockfile instance surface", () => {
	it.effect("packagesNamed returns every resolved version and [] for unknown names", () =>
		Effect.gen(function* () {
			const lockfile = yield* parseFixture("yarn/v2/yarn.lock", "yarn");
			assert.isAtLeast(lockfile.packagesNamed("typescript").length, 2);
			assert.deepStrictEqual(lockfile.packagesNamed("not-in-the-lockfile"), []);
			// Repeated lookups hit the same lazily built index.
			assert.strictEqual(lockfile.packagesNamed("typescript"), lockfile.packagesNamed("typescript"));
		}),
	);

	it.effect("workspacePackages filters on isWorkspace", () =>
		Effect.gen(function* () {
			const lockfile = yield* parseFixture("npm/v1/package-lock.json", "npm");
			assert.strictEqual(lockfile.workspacePackages.length, 2);
			assert.isTrue(lockfile.workspacePackages.every((p) => p.isWorkspace));
		}),
	);
});

describe("Lockfile#withImporterNames (seam repair 1)", () => {
	const names = new Map([
		["packages/core", "@test-monorepo/core"],
		["packages/utils", "@test-monorepo/utils"],
	]);

	it.effect("renames pnpm workspace packages and rewrites both edge ends", () =>
		Effect.gen(function* () {
			const parsed = yield* parseFixture("pnpm/v1/pnpm-lock.yaml", "pnpm");
			const lockfile = parsed.withImporterNames(names);

			assert.deepStrictEqual(
				lockfile.workspacePackages.map((p) => [p.name, p.relativePath]),
				[
					["@test-monorepo/core", "packages/core"],
					["@test-monorepo/utils", "packages/utils"],
				],
			);
			// Versions stay "0.0.0": the map carries names only.
			assert.isTrue(lockfile.workspacePackages.every((p) => p.version === "0.0.0"));

			const edge = lockfile.workspaceDependencies[0];
			assert.strictEqual(edge?.from, "@test-monorepo/core");
			assert.strictEqual(edge?.to, "@test-monorepo/utils");

			// Registry packages and the extension are untouched.
			assert.strictEqual(lockfile.packagesNamed("chalk")[0]?.version, "5.6.2");
			assert.strictEqual(lockfile.extension?._tag, "pnpm");

			// The name index reflects the rewritten names.
			assert.strictEqual(lockfile.packagesNamed("@test-monorepo/core").length, 1);
			assert.deepStrictEqual(lockfile.packagesNamed("packages/core"), []);

			// The original instance is untouched (pure, not in-place).
			assert.strictEqual(parsed.workspacePackages[0]?.name, "packages/core");
		}),
	);

	it.effect("keeps path names for entries not in the map", () =>
		Effect.gen(function* () {
			const parsed = yield* parseFixture("pnpm/v2/pnpm-lock.yaml", "pnpm");
			const lockfile = parsed.withImporterNames(names);

			assert.deepStrictEqual(
				lockfile.workspacePackages.map((p) => p.name),
				["@test-monorepo/core", "packages/new-pkg", "@test-monorepo/utils"],
			);
			// The unmapped importer's edge keeps its path-named end.
			assert.deepStrictEqual(
				lockfile.workspaceDependencies.map((e) => [e.from, e.to]),
				[
					["@test-monorepo/core", "@test-monorepo/utils"],
					["packages/new-pkg", "@test-monorepo/utils"],
				],
			);
		}),
	);

	it.effect("leaves non-pnpm lockfiles unaffected", () =>
		Effect.gen(function* () {
			const parsed = yield* parseFixture("npm/v1/package-lock.json", "npm");
			const lockfile = parsed.withImporterNames(new Map([["not-a-path", "renamed"]]));

			assert.deepStrictEqual(
				lockfile.workspacePackages.map((p) => p.name),
				parsed.workspacePackages.map((p) => p.name),
			);
			assert.deepStrictEqual(
				lockfile.workspaceDependencies.map((e) => [e.from, e.to]),
				parsed.workspaceDependencies.map((e) => [e.from, e.to]),
			);
		}),
	);

	it.effect("is a no-op for an empty map", () =>
		Effect.gen(function* () {
			const parsed = yield* parseFixture("pnpm/v3/pnpm-lock.yaml", "pnpm");
			const lockfile = parsed.withImporterNames(new Map());
			assert.deepStrictEqual(
				lockfile.workspacePackages.map((p) => p.name),
				parsed.workspacePackages.map((p) => p.name),
			);
		}),
	);
});
