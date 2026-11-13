// LockfileDiff.compare: a before/after comparison over the normalized model.
// Real before/after pairs are the `v1` → `v2` fixture sets, which are the same
// test monorepo at two points in time for pnpm, bun and npm. Narrower cases
// are built by editing a real fixture's text, so every input is still a
// lockfile the parser accepts.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Lockfile } from "../src/Lockfile.js";
import { CatalogChange, ImporterChange, LockfileDiff } from "../src/LockfileDiff.js";
import type { LockfileFormat } from "../src/LockfileFormat.js";
import { filenameFor } from "../src/LockfileFormat.js";
import { FIXTURES_DIR, fixture } from "./helpers/fixtures.js";

const parseText = (content: string, format: LockfileFormat, configOnly = false) =>
	Lockfile.parse(content, { format, configOnly });

const parseFixture = (relative: string, format: LockfileFormat) => parseText(fixture(relative), format);

/** Replace a substring that must occur exactly once, so a fixture edit can never silently miss. */
const editOnce = (text: string, from: string, to: string): string => {
	const at = text.indexOf(from);
	assert.isAtLeast(at, 0, `fixture edit target not found: ${from}`);
	assert.strictEqual(text.indexOf(from, at + 1), -1, `fixture edit target not unique: ${from}`);
	return text.slice(0, at) + to + text.slice(at + from.length);
};

/** Add bun's unnamed default `catalog` section to a bun lockfile that has none. */
const withBunCatalog = (text: string, entries: string): string =>
	editOnce(text, '"configVersion": 1,', `"configVersion": 1,\n  "catalog": {\n    ${entries},\n  },`);

/** One line per catalog change: `catalog/name kind specifier version [consumers]`. */
const catalogLines = (diff: LockfileDiff): ReadonlyArray<string> =>
	diff.catalogs.map(
		(c) =>
			`${c.catalog}/${c.name} ${c.kind} ${c.specifier.before ?? "-"}->${c.specifier.after ?? "-"} ` +
			`${c.version.before ?? "-"}->${c.version.after ?? "-"} [${c.consumers.map((u) => `${u.importer}:${u.depType}`).join(",")}]`,
	);

/** One line per importer change: `importer name depType kind specifier version`. */
const importerLines = (diff: LockfileDiff): ReadonlyArray<string> =>
	diff.importers.map(
		(c) =>
			`${c.importer} ${c.name} ${c.depType} ${c.kind} ${c.specifier.before?.raw ?? "-"}->${c.specifier.after?.raw ?? "-"} ` +
			`${c.version.before ?? "-"}->${c.version.after ?? "-"}`,
	);

describe("LockfileDiff.compare", () => {
	describe("no change gives empty arrays", () => {
		// Every fixture the parser accepts, compared with itself. The walk is
		// asserted non-empty first, so a broken enumeration cannot pass vacuously.
		const formats: ReadonlyArray<LockfileFormat> = ["bun", "npm", "pnpm"];
		const cases = formats.flatMap((format) =>
			readdirSync(join(FIXTURES_DIR, format))
				.filter((dir) => !dir.startsWith("unsupported-"))
				.map((dir) => ({ format, relative: `${format}/${dir}/${filenameFor(format)}`, dir })),
		);

		it("enumerates fixtures for every format", () => {
			for (const format of formats) {
				assert.isAbove(cases.filter((c) => c.format === format).length, 1, format);
			}
		});

		for (const { format, relative, dir } of cases) {
			it.effect(relative, () =>
				Effect.gen(function* () {
					const lockfile = yield* parseText(fixture(relative), format, dir.startsWith("env-configonly-"));
					const diff = LockfileDiff.compare(lockfile, lockfile);
					assert.deepStrictEqual(diff.catalogs, []);
					assert.deepStrictEqual(diff.importers, []);
					assert.isFalse(diff.hasChanges);
				}),
			);
		}
	});

	describe("pnpm", () => {
		it.effect("v1 → v2: catalogs and importers added, removed and changed", () =>
			Effect.gen(function* () {
				const before = yield* parseFixture("pnpm/v1/pnpm-lock.yaml", "pnpm");
				const after = yield* parseFixture("pnpm/v2/pnpm-lock.yaml", "pnpm");
				const diff = LockfileDiff.compare(before, after);

				assert.isTrue(diff.hasChanges);
				assert.deepStrictEqual(catalogLines(diff), [
					// A removed entry's consumers come from BEFORE: nobody references it after.
					"default/chalk removed ^5.3.0->- 5.6.2->- [packages/utils:dependencies]",
					"default/zod added -->^3.23.0 -->3.25.76 [packages/core:dependencies]",
					"silk/@effect/platform added -->>=0.78.0 -->0.96.0 [packages/utils:dependencies]",
					"silk/effect added -->>=3.14.0 -->3.21.0 [packages/core:dependencies]",
				]);
				assert.deepStrictEqual(importerLines(diff), [
					"packages/core effect dependencies added -->catalog:silk -->3.21.0",
					"packages/core fsevents optionalDependencies added -->^2.3.0 -->2.3.3",
					"packages/core lodash dependencies changed 4.17.21->4.17.23 4.17.21->4.17.23",
					"packages/core typescript devDependencies removed ^5.3.0->- 5.9.3->-",
					"packages/core zod dependencies added -->catalog: -->3.25.76",
					// A whole new importer: every dependency is added.
					"packages/new-pkg @test-monorepo/utils dependencies added -->workspace:* -->link:../utils",
					// The plain version: pnpm's peer suffix is not part of it.
					"packages/utils @effect/platform dependencies added -->catalog:silk -->0.96.0",
					"packages/utils chalk dependencies removed catalog:->- 5.6.2->-",
					"packages/utils vitest devDependencies added -->^3.0.0 -->3.2.4",
				]);
			}),
		);

		it.effect("a version that moves under an unchanged specifier is a change, in catalog and importer", () =>
			Effect.gen(function* () {
				const text = fixture("pnpm/v3/pnpm-lock.yaml");
				const before = yield* parseText(text, "pnpm");
				const after = yield* parseText(text.replaceAll("version: 4.17.23", "version: 4.17.24"), "pnpm");
				const diff = LockfileDiff.compare(before, after);

				assert.deepStrictEqual(catalogLines(diff), [
					"default/lodash changed ^4.17.23->^4.17.23 4.17.23->4.17.24 [packages/core:dependencies]",
				]);
				assert.deepStrictEqual(importerLines(diff), [
					"packages/core lodash dependencies changed catalog:->catalog: 4.17.23->4.17.24",
				]);
				// The specifier stays classified, so a consumer can keep catalog
				// movement out of the importer list.
				assert.strictEqual(diff.importers[0]?.specifier.after?._tag, "catalog");
			}),
		);

		it.effect("the importer-name rewrite does not change the answer", () =>
			Effect.gen(function* () {
				const before = yield* parseFixture("pnpm/v1/pnpm-lock.yaml", "pnpm");
				const after = yield* parseFixture("pnpm/v2/pnpm-lock.yaml", "pnpm");
				const renamed = before.withImporterNames(new Map([["packages/core", "@test-monorepo/core"]]));
				assert.deepStrictEqual(LockfileDiff.compare(renamed, after), LockfileDiff.compare(before, after));
			}),
		);

		it.effect("dependency and catalog names that are Object members are ordinary keys", () =>
			Effect.gen(function* () {
				const header = "lockfileVersion: '9.0'\n";
				const body = [
					"importers:",
					"  .:",
					"    dependencies:",
					"      constructor:",
					"        specifier: catalog:__proto__",
					"        version: 1.0.0",
				].join("\n");
				const before = yield* parseText(`${header}importers:\n  .: {}\n`, "pnpm");
				const after = yield* parseText(
					`${header}catalogs:\n  __proto__:\n    constructor:\n      specifier: ^1.0.0\n      version: 1.0.0\n${body}\n`,
					"pnpm",
				);
				const diff = LockfileDiff.compare(before, after);
				assert.deepStrictEqual(catalogLines(diff), ["__proto__/constructor added -->^1.0.0 -->1.0.0 [.:dependencies]"]);
				assert.deepStrictEqual(importerLines(diff), [". constructor dependencies added -->catalog:__proto__ -->1.0.0"]);
				assert.strictEqual(Object.getPrototypeOf({}), Object.prototype);
			}),
		);
	});

	describe("bun", () => {
		it.effect("v1 → v2: catalog versions come from the entries' consumers", () =>
			Effect.gen(function* () {
				const before = yield* parseFixture("bun/v1/bun.lock", "bun");
				const after = yield* parseFixture("bun/v2/bun.lock", "bun");
				const diff = LockfileDiff.compare(before, after);

				assert.deepStrictEqual(catalogLines(diff), [
					// bun's unnamed `catalog` section is the "default" catalog.
					"default/react changed ^19.0.0->^19.1.0 19.2.4->19.2.4 [packages/core:peerDependencies]",
					"default/react-dom changed ^19.0.0->^19.1.0 19.2.4->19.2.4 [packages/core:dependencies]",
					"default/zod added -->^3.23.0 -->3.25.76 [packages/core:dependencies]",
					"testing/vitest added -->^3.0.0 -->3.2.4 [packages/utils:devDependencies]",
				]);
				assert.deepStrictEqual(importerLines(diff), [
					"packages/core fsevents optionalDependencies added -->^2.3.0 -->2.3.3",
					// One name in two sections compares section by section.
					"packages/core react dependencies removed catalog:->- 19.2.4->-",
					"packages/core react peerDependencies added -->catalog: -->19.2.4",
					"packages/core typescript devDependencies removed ^5.3.0->- 5.9.3->-",
					"packages/core zod dependencies added -->catalog: -->3.25.76",
					// A workspace dependency reads the link pnpm records, not the workspace's own version.
					"packages/new-pkg @test-monorepo/utils dependencies added -->workspace:* -->link:../utils",
					"packages/utils chalk dependencies removed ^5.3.0->- 5.6.2->-",
					"packages/utils vitest devDependencies added -->catalog:testing -->3.2.4",
				]);
			}),
		);

		it.effect("a version resolvable on one side only is not by itself a change", () =>
			Effect.gen(function* () {
				const text = fixture("bun/v3/bun.lock");
				const reactTuple = /\n {4}"react": \["react@19\.2\.4"[^\n]*\n/;
				assert.match(text, reactTuple);
				const before = yield* parseText(text, "bun");
				// After: react's package entry is gone, so its version cannot be resolved.
				const unresolved = yield* parseText(text.replace(reactTuple, "\n"), "bun");
				const diff = LockfileDiff.compare(before, unresolved);
				assert.deepStrictEqual(diff.catalogs, []);
				assert.deepStrictEqual(diff.importers, []);

				// Control: the same entry resolving to another version IS a change.
				const moved = yield* parseText(text.replace('"react@19.2.4"', '"react@19.3.0"'), "bun");
				const control = LockfileDiff.compare(before, moved);
				assert.deepStrictEqual(catalogLines(control), [
					"default/react changed ^19.1.0->^19.1.0 19.2.4->19.3.0 [packages/core:dependencies]",
				]);
				assert.deepStrictEqual(importerLines(control), [
					"packages/core react dependencies changed catalog:->catalog: 19.2.4->19.3.0",
				]);
			}),
		);

		it.effect("a catalog entry nobody consumes resolves by its one package version", () =>
			Effect.gen(function* () {
				const text = fixture("bun/v1/bun.lock");
				const before = yield* parseText(text, "bun");
				const after = yield* parseText(
					text.replace('"react": "^19.0.0",', '"chalk": "^5.3.0",\n    "react": "^19.0.0",'),
					"bun",
				);
				const diff = LockfileDiff.compare(before, after);
				assert.deepStrictEqual(catalogLines(diff), ["default/chalk added -->^5.3.0 -->5.6.2 []"]);
				assert.deepStrictEqual(diff.importers, []);
			}),
		);
	});

	describe("npm", () => {
		it.effect("v1 → v2: versions come from the importers' resolved edges; npm has no catalogs", () =>
			Effect.gen(function* () {
				const before = yield* parseFixture("npm/v1/package-lock.json", "npm");
				const after = yield* parseFixture("npm/v2/package-lock.json", "npm");
				const diff = LockfileDiff.compare(before, after);

				assert.deepStrictEqual(diff.catalogs, []);
				assert.deepStrictEqual(importerLines(diff), [
					"packages/core fsevents optionalDependencies added -->^2.3.0 -->2.3.3",
					// The specifier moved; the resolved version did not.
					"packages/core lodash dependencies changed ^4.17.21->^4.17.23 4.17.23->4.17.23",
					"packages/core react peerDependencies added -->^19.0.0 -->19.2.4",
					"packages/core typescript devDependencies removed ^5.3.0->- 5.9.3->-",
					"packages/core zod dependencies added -->^3.23.0 -->3.25.76",
					"packages/new-pkg @test-monorepo/utils dependencies added -->* -->link:../utils",
					"packages/utils chalk dependencies removed ^5.3.0->- 5.6.2->-",
					"packages/utils vitest devDependencies added -->^3.0.0 -->3.2.4",
				]);
			}),
		);

		it.effect("the root importer resolves at the top of the tree", () =>
			Effect.gen(function* () {
				const text = fixture("npm/v1/package-lock.json");
				const before = yield* parseText(text, "npm");
				const after = yield* parseText(
					text.replace(
						'"node_modules/typescript": {\n      "version": "5.9.3"',
						'"node_modules/typescript": {\n      "version": "5.9.4"',
					),
					"npm",
				);
				const diff = LockfileDiff.compare(before, after);
				assert.include(importerLines(diff), ". typescript devDependencies changed ^5.3.0->^5.3.0 5.9.3->5.9.4");
			}),
		);
	});

	describe("version normalization over nested copies", () => {
		// The `nested` fixtures hold two copies of react: 17.0.2 at the top of
		// the tree, which the root importer uses, and 18.3.1 nested under
		// packages/lib, which that workspace uses. Each rule below is pinned
		// on an input where a simpler reading (resolve everything at the
		// top, join a catalog by name only, take the first consumer's
		// version) gives a different answer.

		it.effect("npm: a workspace resolves through its own edge, the root at the top of the tree", () =>
			Effect.gen(function* () {
				const text = fixture("npm/nested/package-lock.json");
				const before = yield* parseText(text, "npm");

				const nested = yield* parseText(editOnce(text, '"version": "18.3.1"', '"version": "18.3.2"'), "npm");
				assert.deepStrictEqual(importerLines(LockfileDiff.compare(before, nested)), [
					"packages/lib react dependencies changed 18.3.1->18.3.1 18.3.1->18.3.2",
					"packages/lib react peerDependencies changed ^18.0.0->^18.0.0 18.3.1->18.3.2",
				]);

				const hoisted = yield* parseText(editOnce(text, '"version": "17.0.2"', '"version": "17.0.3"'), "npm");
				assert.deepStrictEqual(importerLines(LockfileDiff.compare(before, hoisted)), [
					". react dependencies changed 17.0.2->17.0.2 17.0.2->17.0.3",
				]);
			}),
		);

		it.effect("bun: a workspace resolves through its own edge, the root at the top of the tree", () =>
			Effect.gen(function* () {
				const text = fixture("bun/nested/bun.lock");
				const before = yield* parseText(text, "bun");

				const nested = yield* parseText(editOnce(text, '["react@18.3.1"', '["react@18.3.2"'), "bun");
				assert.deepStrictEqual(importerLines(LockfileDiff.compare(before, nested)), [
					"packages/lib react dependencies changed 18.3.1->18.3.1 18.3.1->18.3.2",
					"packages/lib react peerDependencies changed ^18.0.0->^18.0.0 18.3.1->18.3.2",
				]);

				const hoisted = yield* parseText(editOnce(text, '["react@17.0.2"', '["react@17.0.3"'), "bun");
				assert.deepStrictEqual(importerLines(LockfileDiff.compare(before, hoisted)), [
					". react dependencies changed 17.0.2->17.0.2 17.0.2->17.0.3",
				]);
			}),
		);

		it.effect("bun: a catalog entry takes its consumers' version, not a name join", () =>
			Effect.gen(function* () {
				const text = fixture("bun/nested/bun.lock");
				const before = yield* parseText(text, "bun");
				// Only packages/lib consumes the catalog entry. The lockfile holds
				// two react versions, so a join by name alone is ambiguous; the
				// consumer's edge is not.
				const after = yield* parseText(
					editOnce(withBunCatalog(text, '"react": "^18.0.0"'), '"react": "18.3.1",', '"react": "catalog:",'),
					"bun",
				);
				assert.deepStrictEqual(catalogLines(LockfileDiff.compare(before, after)), [
					"default/react added -->^18.0.0 -->18.3.1 [packages/lib:dependencies]",
				]);
			}),
		);

		it.effect("bun: catalog consumers that disagree give no version", () =>
			Effect.gen(function* () {
				const text = fixture("bun/nested/bun.lock");
				const before = yield* parseText(text, "bun");
				// The root resolves react to 17.0.2 and packages/lib to 18.3.1.
				const after = yield* parseText(
					editOnce(
						editOnce(withBunCatalog(text, '"react": "^18.0.0"'), '"react": "18.3.1",', '"react": "catalog:",'),
						'"react": "17.0.2",',
						'"react": "catalog:",',
					),
					"bun",
				);
				assert.deepStrictEqual(catalogLines(LockfileDiff.compare(before, after)), [
					"default/react added -->^18.0.0 -->- [.:dependencies,packages/lib:dependencies]",
				]);
			}),
		);
	});

	describe("workspace links compare alike in pnpm, bun and npm", () => {
		// The `wsbump-before` → `wsbump-after` fixture pairs (hand-authored; see
		// the fixtures README) are one workspace in three formats: the root and
		// packages/a depend on packages/b through a workspace link, and the
		// release bumps packages/b from 1.0.0 to 1.0.1 and its `ms` from 2.0.0 to
		// 2.1.3. pnpm records the link edge as `link:<path>` and never records
		// packages/b's own version, so only `ms` moves. bun and npm record
		// packages/b's version on its workspace row; reading the edge through that
		// row would report every dependent as changed on every release.
		const formats = [
			{ format: "pnpm", file: "pnpm-lock.yaml" },
			{ format: "bun", file: "bun.lock" },
			{ format: "npm", file: "package-lock.json" },
		] as const;
		const expected = ["packages/b ms dependencies changed ^2.0.0->^2.0.0 2.0.0->2.1.3"];

		it.effect("a sibling's version bump is not a change to its dependents, and all three diffs agree", () =>
			Effect.gen(function* () {
				const answers: Array<ReadonlyArray<string>> = [];
				for (const { format, file } of formats) {
					const before = yield* parseFixture(`${format}/wsbump-before/${file}`, format);
					const after = yield* parseFixture(`${format}/wsbump-after/${file}`, format);
					const diff = LockfileDiff.compare(before, after);
					assert.deepStrictEqual(diff.catalogs, [], format);
					assert.deepStrictEqual(importerLines(diff), expected, format);
					answers.push(importerLines(diff));
				}
				assert.deepStrictEqual(answers[1], answers[0]);
				assert.deepStrictEqual(answers[2], answers[0]);
			}),
		);

		it.effect("a workspace edge resolves to the link pnpm records, relative to the importer", () =>
			Effect.gen(function* () {
				for (const { format, file } of formats) {
					const lockfile = yield* parseFixture(`${format}/wsbump-before/${file}`, format);
					// Every dependency added at once, so each resolved version is on show.
					const empty = Lockfile.make({ ...lockfile, importers: [] });
					const versions = LockfileDiff.compare(empty, lockfile).importers.map(
						(c) => `${c.importer} ${c.name} ${c.version.after ?? "-"}`,
					);
					assert.deepStrictEqual(
						versions,
						[". @wsbump/b link:packages/b", "packages/a @wsbump/b link:../b", "packages/b ms 2.0.0"],
						format,
					);
				}
			}),
		);
	});

	describe("local file: targets and workspace catalog entries compare alike in pnpm, bun and npm", () => {
		// The `filelink-before` → `filelink-after` pairs are real pnpm, npm and
		// bun output over one workspace (provenance in the fixtures README). The
		// root and packages/a depend on a `file:` directory and a `file:` tarball
		// under vendor/, neither of them a workspace; pnpm and bun also reach
		// packages/b through a default catalog entry `workspace:*`. `after` bumps
		// both local targets and packages/b from 1.0.0 to 1.0.1, and packages/b's
		// `ms` from 2.0.0 to 2.1.3. pnpm records a local target by its
		// root-relative path and a workspace catalog entry by its specifier, so
		// only `ms` moves.
		const formats = [
			{ format: "pnpm", file: "pnpm-lock.yaml" },
			{ format: "bun", file: "bun.lock" },
			{ format: "npm", file: "package-lock.json" },
		] as const;

		it.effect("a version bump inside a local target or a workspace is no change, and all three diffs agree", () =>
			Effect.gen(function* () {
				for (const { format, file } of formats) {
					const before = yield* parseFixture(`${format}/filelink-before/${file}`, format);
					const after = yield* parseFixture(`${format}/filelink-after/${file}`, format);
					const diff = LockfileDiff.compare(before, after);
					assert.deepStrictEqual(diff.catalogs, [], format);
					assert.deepStrictEqual(
						importerLines(diff),
						["packages/b ms dependencies changed 2.0.0->2.1.3 2.0.0->2.1.3"],
						format,
					);
				}
			}),
		);

		it.effect("a file: edge reads the root-relative file: path pnpm records, from every importer", () =>
			Effect.gen(function* () {
				const read = (lockfile: Lockfile) =>
					LockfileDiff.compare(Lockfile.make({ ...lockfile, importers: [] }), lockfile).importers.map(
						(c) => `${c.importer} ${c.name} ${c.version.after ?? "-"}`,
					);
				const local = [
					". local-dir file:vendor/local-dir",
					". local-tar file:vendor/local-tar.tgz",
					"packages/a local-dir file:vendor/local-dir",
					"packages/a local-tar file:vendor/local-tar.tgz",
				];
				const pnpm = read(yield* parseFixture("pnpm/filelink-before/pnpm-lock.yaml", "pnpm"));
				// The control: these are the values pnpm itself writes.
				assert.deepStrictEqual(pnpm, [
					". @fl/b link:packages/b",
					...local.slice(0, 2),
					"packages/a @fl/b link:../b",
					...local.slice(2),
					"packages/b ms 2.0.0",
				]);
				const bun = read(yield* parseFixture("bun/filelink-before/bun.lock", "bun"));
				assert.deepStrictEqual(bun, pnpm);
				// npm has no catalogs, so its importers reach packages/b with `*`
				// from packages/a only.
				const npm = read(yield* parseFixture("npm/filelink-before/package-lock.json", "npm"));
				assert.deepStrictEqual(npm, [
					...local.slice(0, 2),
					"packages/a @fl/b link:../b",
					...local.slice(2),
					"packages/b ms 2.0.0",
				]);
			}),
		);

		it.effect("a file: specifier that lands on a workspace reads as the workspace link pnpm records", () =>
			Effect.gen(function* () {
				// The `fileworkspace` captures: packages/a declares `@fl/b: file:../b`,
				// where packages/b is a workspace. pnpm records the edge `link:../b`,
				// so the workspace wins over the `file:` spelling.
				const read = (lockfile: Lockfile) =>
					LockfileDiff.compare(Lockfile.make({ ...lockfile, importers: [] }), lockfile).importers.map(
						(c) => `${c.importer} ${c.name} ${c.version.after ?? "-"}`,
					);
				const pnpm = read(yield* parseFixture("pnpm/fileworkspace/pnpm-lock.yaml", "pnpm"));
				assert.deepStrictEqual(pnpm, ["packages/a @fl/b link:../b", "packages/b ms 2.0.0"]);
				assert.deepStrictEqual(read(yield* parseFixture("bun/fileworkspace/bun.lock", "bun")), pnpm);
				// npm writes this edge exactly as it writes a `file:` directory that
				// is no workspace; the root entry's `workspaces` globs tell them apart.
				assert.deepStrictEqual(read(yield* parseFixture("npm/fileworkspace/package-lock.json", "npm")), pnpm);
			}),
		);

		it.effect("a catalog entry that resolves to a workspace reads its own specifier, as pnpm records it", () =>
			Effect.gen(function* () {
				for (const { format, file } of formats.filter((f) => f.format !== "npm")) {
					const lockfile = yield* parseFixture(`${format}/filelink-before/${file}`, format);
					const { extension: _extension, ...withoutCatalogs } = lockfile;
					const diff = LockfileDiff.compare(Lockfile.make(withoutCatalogs), lockfile);
					assert.deepStrictEqual(
						catalogLines(diff),
						["default/@fl/b added -->workspace:* -->workspace:* [.:dependencies,packages/a:dependencies]"],
						format,
					);
				}
			}),
		);
	});
});

describe("change records", () => {
	it("reject a kind that disagrees with the sides", () => {
		assert.throws(() =>
			CatalogChange.make({
				catalog: "default",
				name: "zod",
				specifier: { before: "^3.0.0" },
				version: {},
				kind: "added",
				consumers: [],
			}),
		);
		assert.throws(() =>
			CatalogChange.make({
				catalog: "default",
				name: "zod",
				specifier: { before: "^3.0.0", after: "^3.0.0" },
				version: { before: "3.0.0" },
				kind: "changed",
				consumers: [],
			}),
		);
		// Control: the consistent record constructs.
		const ok = CatalogChange.make({
			catalog: "default",
			name: "zod",
			specifier: { after: "^3.0.0" },
			version: { after: "3.0.0" },
			kind: "added",
			consumers: [],
		});
		assert.strictEqual(ok.kind, "added");
	});

	it.effect("an importer change reads its specifier sides by raw string", () =>
		Effect.gen(function* () {
			const lockfile = yield* parseFixture("pnpm/v3/pnpm-lock.yaml", "pnpm");
			const lodash = lockfile.importers
				.flatMap((importer) => importer.dependencies)
				.find((dep) => dep.name === "lodash");
			assert.isDefined(lodash);
			if (lodash === undefined) return;
			assert.throws(() =>
				ImporterChange.make({
					importer: "packages/core",
					name: "lodash",
					depType: "dependencies",
					specifier: { before: lodash.specifier, after: lodash.specifier },
					version: {},
					kind: "changed",
				}),
			);
			const removed = ImporterChange.make({
				importer: "packages/core",
				name: "lodash",
				depType: "dependencies",
				specifier: { before: lodash.specifier },
				version: { before: "4.17.23" },
				kind: "removed",
			});
			assert.strictEqual(removed.specifier.before?.raw, "catalog:");
		}),
	);
});
