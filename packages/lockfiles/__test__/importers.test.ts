// Per-format importer extraction: the `Lockfile.importers` field and the
// `lockfile.importer(path)` keyed lookup. pnpm records `{ specifier, version }`
// per importer dependency — the parser splits pnpm's peer-disambiguation
// suffix off the version into `peerSuffix`; bun and npm record a specifier
// only (the resolved version lives on package entries); yarn records no
// importers at all.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Lockfile, LockfileParseError } from "../src/Lockfile.js";
import type { LockfileFormat } from "../src/LockfileFormat.js";
import { fixture } from "./helpers/fixtures.js";

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

		it.effect("v2: a peer-suffixed version splits into a plain version and peerSuffix", () =>
			Effect.gen(function* () {
				const lockfile = yield* parseFixture("pnpm/v2/pnpm-lock.yaml", "pnpm");
				const utils = Option.getOrThrow(lockfile.importer("packages/utils"));
				const platform = utils.dependencies.find((d) => d.name === "@effect/platform");
				assert.strictEqual(platform?.version, "0.96.0");
				assert.strictEqual(platform?.peerSuffix, "(effect@3.21.0)");
			}),
		);

		it.effect("peer-disambiguation suffixes split off; link:/file: resolutions pass through verbatim", () =>
			Effect.gen(function* () {
				// The exact literal from issue #165, nested-suffix chain included.
				const content = [
					"lockfileVersion: '9.0'",
					"importers:",
					"  .:",
					"    dependencies:",
					"      '@effect/experimental':",
					"        specifier: 4.0.0-beta.101",
					"        version: 4.0.0-beta.101(effect@4.0.0-beta.101)(ioredis@5.11.1(supports-color@8.1.1))",
					"      effect:",
					"        specifier: 4.0.0-beta.101",
					"        version: 4.0.0-beta.101",
					"      '@local/utils':",
					"        specifier: workspace:*",
					"        version: link:packages/utils",
					"      vendored:",
					"        specifier: file:vendor/vendored",
					"        version: file:vendor/vendored",
					"",
				].join("\n");
				const lockfile = yield* Lockfile.parse(content, { format: "pnpm" });
				const root = Option.getOrThrow(lockfile.importer("."));

				const experimental = root.dependencies.find((d) => d.name === "@effect/experimental");
				assert.strictEqual(experimental?.version, "4.0.0-beta.101");
				assert.strictEqual(experimental?.peerSuffix, "(effect@4.0.0-beta.101)(ioredis@5.11.1(supports-color@8.1.1))");

				// A suffix-free entry keeps its version and records no peerSuffix key.
				const effect = root.dependencies.find((d) => d.name === "effect");
				assert.strictEqual(effect?.version, "4.0.0-beta.101");
				assert.isFalse(Object.hasOwn(effect ?? {}, "peerSuffix"));

				// Non-version resolutions pass through untouched, no suffix field.
				const linked = root.dependencies.find((d) => d.name === "@local/utils");
				assert.strictEqual(linked?.version, "link:packages/utils");
				assert.isFalse(Object.hasOwn(linked ?? {}, "peerSuffix"));

				const vendored = root.dependencies.find((d) => d.name === "vendored");
				assert.strictEqual(vendored?.version, "file:vendor/vendored");
				assert.isFalse(Object.hasOwn(vendored ?? {}, "peerSuffix"));
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

describe("npm link rows", () => {
	// npm writes a `file:` directory dependency exactly like a workspace link
	// (`{ resolved, link: true }`); only the root entry's `workspaces` globs
	// tell them apart. `npm/filelink-before` links `vendor/local-dir`, which the
	// globs (`packages/*`) do not cover.
	const text = fixture("npm/filelink-before/package-lock.json");

	it.effect("a link whose target the workspace globs miss is a plain package, not a workspace or an importer", () =>
		Effect.gen(function* () {
			const lockfile = yield* Lockfile.parse(text, { format: "npm" });
			assert.deepStrictEqual(
				lockfile.importers.map((importer) => importer.path),
				[".", "packages/a", "packages/b"],
			);
			const local = Option.getOrThrow(lockfile.packageByInstanceId("node_modules/local-dir"));
			assert.isFalse(local.isWorkspace);
			assert.strictEqual(local.version, "1.0.0");
			// Control: the workspace links stay workspaces.
			const b = Option.getOrThrow(lockfile.packageByInstanceId("node_modules/@fl/b"));
			assert.isTrue(b.isWorkspace);
			assert.strictEqual(b.relativePath, "packages/b");
		}),
	);

	it.effect(
		"workspace globs read as npm reads them: a leading ./, a trailing /, odd and even !, dot and /** ignores",
		() =>
			Effect.gen(function* () {
				// Real npm 11.20.0 output (fixtures README): the root declares
				// ["./packages/*/", "!packages/skip", "!!extra/c", "tools/**",
				// "!tools/deep/**"] and depends through `file:` on packages/skip,
				// packages/.hidden and tools/deep/t. `npm query .workspace` lists
				// exactly packages/a and extra/c.
				const lockfile = yield* parseFixture("npm/workspaceglobs/package-lock.json", "npm");
				const workspaces = lockfile.packages.filter((pkg) => pkg.isWorkspace).map((pkg) => pkg.relativePath);
				assert.deepStrictEqual([...workspaces].sort(), ["extra/c", "packages/a"]);
				assert.deepStrictEqual(
					lockfile.importers.map((importer) => importer.path),
					[".", "packages/a", "extra/c"],
				);
				// Control: the three non-workspace links are still rows, as plain packages.
				const plain = lockfile.packages.filter((pkg) => !pkg.isWorkspace).map((pkg) => pkg.name);
				assert.deepStrictEqual([...plain].sort(), ["hidden", "skip", "t"]);
			}),
	);

	it.effect("a later positive workspace glob the negation matches cancels it, as npm's map-workspaces does", () =>
		Effect.gen(function* () {
			// Real npm 11.20.0 output: ["packages/**", "!packages/b/**",
			// "packages/b/a"]. The last pattern, read as a path, matches the
			// negation, so the negation is dropped whole and packages/b/z, linked
			// through `file:`, is a workspace too (`npm query .workspace` agrees).
			const lockfile = yield* parseFixture("npm/workspacecancel/package-lock.json", "npm");
			assert.deepStrictEqual(
				lockfile.importers.map((importer) => importer.path),
				[".", "packages/b/a", "packages/b/z", "packages/x"],
			);
			assert.isTrue(lockfile.packages.every((pkg) => pkg.isWorkspace));
		}),
	);

	it.effect("a /** negation ignores what it matches directly, and a climbing .. is never its child", () =>
		Effect.gen(function* () {
			// Real npm 11.20.0 output from a root two levels down, declaring
			// ["../../x", "../y", "!../**"] and depending on both through `file:`.
			// `npm query .workspace` lists only ../../x: `!../**` matches ../y
			// itself, while ../../x is a parent of `..`, never a child, so glob's
			// children rule does not reach it.
			const lockfile = yield* parseFixture("npm/workspaceclimb/package-lock.json", "npm");
			assert.isTrue(Option.getOrThrow(lockfile.packageByInstanceId("node_modules/x")).isWorkspace);
			assert.isFalse(Option.getOrThrow(lockfile.packageByInstanceId("node_modules/y")).isWorkspace);
			assert.deepStrictEqual(
				lockfile.importers.map((importer) => importer.path),
				[".", "../../x"],
			);
		}),
	);

	it.effect("a positive pattern ending in /. names the directory itself, as npm reads it; a negation's does not", () =>
		Effect.gen(function* () {
			// Real npm 11.20.0 output (fixtures README): workspaces
			// ["packages/a/.", "tools/*/.", "libs/l/./", "neg/*", "!neg/n/."], and a
			// `file:` link to packages/b. `npm query .workspace` lists libs/l,
			// neg/n, packages/a, tools/t1 and tools/t2: glob's walk resolves a
			// positive's trailing `.` to the directory, while `!neg/n/.` ignores
			// nothing.
			const lockfile = yield* parseFixture("npm/workspacedotend/package-lock.json", "npm");
			const workspaces = lockfile.packages.filter((pkg) => pkg.isWorkspace).map((pkg) => pkg.relativePath);
			assert.deepStrictEqual([...workspaces].sort(), ["libs/l", "neg/n", "packages/a", "tools/t1", "tools/t2"]);
			// Control: the `file:` link the globs miss stays a plain package.
			assert.isFalse(Option.getOrThrow(lockfile.packageByInstanceId("node_modules/b")).isWorkspace);
		}),
	);

	it.effect("a hand-written resolved decides as npm's normalized spelling of it does", () =>
		Effect.gen(function* () {
			// npm writes `resolved` normalized; the decision reads a trailing `/`,
			// a `./` segment or a doubled `/` as the path npm would write, so a
			// plain path (a set lookup) and a wildcard (a glob match) agree. `..`
			// is kept as written.
			const lockfile = (workspaces: ReadonlyArray<string>, resolved: ReadonlyArray<string>) =>
				Lockfile.parse(
					JSON.stringify({
						name: "root",
						lockfileVersion: 3,
						packages: Object.fromEntries([
							["", { name: "root", workspaces }],
							...resolved.flatMap((dir, i) => [
								[`node_modules/l${i}`, { resolved: dir, link: true }],
								[dir, { name: `l${i}`, version: "1.0.0" }],
							]),
						]),
					}),
					{ format: "npm" },
				);
			const workspaces = (parsed: Lockfile) =>
				parsed.packages.filter((pkg) => pkg.isWorkspace).map((pkg) => pkg.instanceId);
			const resolved = ["packages/a/", "./packages/b", "packages//c", "packages/./d", "../x/./y"];
			const literal = yield* lockfile(["packages/a", "packages/b", "packages/c", "packages/d", "../x/y"], resolved);
			assert.deepStrictEqual(workspaces(literal), [
				"node_modules/l0",
				"node_modules/l1",
				"node_modules/l2",
				"node_modules/l3",
				"node_modules/l4",
			]);
			const wildcard = yield* lockfile(["packages/*", "../x/*"], resolved);
			assert.deepStrictEqual(workspaces(wildcard), workspaces(literal));
			// A literal negation reads the same normalized directory.
			const negated = yield* lockfile(["packages/*", "!packages/a"], resolved.slice(0, 2));
			assert.deepStrictEqual(workspaces(negated), ["node_modules/l1"]);
			// Control: `..` is not resolved away, so `../x/y` is not `y`.
			const unresolved = yield* lockfile(["y"], ["../x/../y"]);
			assert.deepStrictEqual(workspaces(unresolved), []);
		}),
	);

	it.effect("a workspace reached through two link rows is one importer", () =>
		Effect.gen(function* () {
			// Real npm 11.20.0 output (fixtures README): the root depends on
			// `z: file:packages/b/z`, an alias for the workspace at packages/b/z,
			// so npm writes two link rows, `node_modules/wpackages_b_z` and
			// `node_modules/z`, with the same `resolved`.
			const lockfile = yield* parseFixture("npm/workspacealias/package-lock.json", "npm");
			assert.deepStrictEqual(
				lockfile.importers.map((importer) => importer.path),
				[".", "packages/b/a", "packages/b/z", "packages/x"],
			);
			// Control: both link rows are still package instances, each its own id.
			const rows = lockfile.packages.filter((pkg) => pkg.relativePath === "packages/b/z").map((pkg) => pkg.instanceId);
			assert.deepStrictEqual([...rows].sort(), ["node_modules/wpackages_b_z", "node_modules/z"]);
		}),
	);

	it.effect("globs are matched as npm writes them: a leading ./ and a trailing / do not matter", () =>
		Effect.gen(function* () {
			const edited = text.replace('"packages/*"', '"./packages/*/"');
			assert.notStrictEqual(edited, text);
			const lockfile = yield* Lockfile.parse(edited, { format: "npm" });
			assert.isTrue(Option.getOrThrow(lockfile.packageByInstanceId("node_modules/@fl/b")).isWorkspace);
			assert.isFalse(Option.getOrThrow(lockfile.packageByInstanceId("node_modules/local-dir")).isWorkspace);
		}),
	);

	it.effect("a pattern too long to match fails the parse typed, naming its index, with no fallback reading", () =>
		Effect.gen(function* () {
			// A wildcard of 65,538 characters, positive or negated, is refused by
			// the 256-character ceiling before glob sees it. Before any ceiling,
			// glob refused it and every link row read as a workspace, `file:`
			// directories included.
			for (const pattern of [`${"a".repeat(65_537)}*`, `!${"a".repeat(65_537)}*`]) {
				const edited = text.replace('"packages/*"', `"packages/*", "${pattern}"`);
				assert.notStrictEqual(edited, text);
				const error = yield* Effect.flip(Lockfile.parse(edited, { format: "npm" }));
				assert.instanceOf(error, LockfileParseError);
				if (!(error instanceof LockfileParseError)) return;
				assert.strictEqual(error.stage, "validation");
				assert.include(String((error.cause as Error).message), "pattern at index 1 is 65538 characters long");
			}
		}),
	);

	it.effect("with no workspaces field, no link row is a workspace", () =>
		Effect.gen(function* () {
			const edited = text.replace(/"workspaces": \[\s*"packages\/\*"\s*\],/, "");
			assert.notStrictEqual(edited, text);
			const lockfile = yield* Lockfile.parse(edited, { format: "npm" });
			assert.isFalse(lockfile.packages.some((pkg) => pkg.isWorkspace));
			assert.deepStrictEqual(
				lockfile.importers.map((importer) => importer.path),
				["."],
			);
		}),
	);
});
