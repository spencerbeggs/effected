/**
 * A CI build whose API Extractor pass fails on a CI-fatal message, through the real tsdown, tsgo and API Extractor
 * (#1317). The build still fails, but its `issues.json` records what a local build of the same tree records: every
 * warning, every error, and Run B's source locations, with the CI-fatal entry at error level.
 */
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer } from "effect";
import { Bundler } from "../../src/Bundler.js";
import { EffectedConfigFile } from "../../src/config/EffectedConfigFile.js";

const FIXTURE = resolve(import.meta.dirname, "../fixtures/ci-meta");
const TIMEOUT = 180_000;

const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const discovery = WorkspaceDiscovery.layer().pipe(
	Layer.provideMerge(WorkspaceRoot.layer),
	Layer.provideMerge(platform),
);

const roots: string[] = [];
afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A fresh copy of the fixture workspace; returns the package directory. */
const makePackage = (): string => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "bundler-ci-meta-")));
	roots.push(root);
	cpSync(FIXTURE, root, { recursive: true });
	return join(root, "packages", "p");
};

const build = (cwd: string, ci: boolean) =>
	Effect.gen(function* () {
		const { config } = yield* EffectedConfigFile.load({ cwd });
		return yield* Bundler.build({
			cwd,
			config: config.package.build,
			bundle: config.package.bundle,
			noExe: true,
			verbose: false,
			plugins: [],
			ci,
		});
	}).pipe(Effect.provide(discovery));

interface Entry {
	readonly source: string;
	readonly level: string;
	readonly text: string;
	readonly code?: string;
	readonly ciFatal?: boolean;
	readonly file?: string;
	readonly line?: number;
	readonly column?: number;
}

interface Issues {
	readonly buildOk: boolean;
	readonly failure?: { readonly name?: string; readonly message: string };
	readonly warnings: ReadonlyArray<Entry>;
	readonly errors: ReadonlyArray<Entry>;
	readonly suppressed: ReadonlyArray<Entry>;
}

const readIssues = (cwd: string): Issues =>
	JSON.parse(readFileSync(join(cwd, "dist", "prod", "issues.json"), "utf-8")) as Issues;

/** An entry with its level and the local-only ciFatal tag dropped: what a CI and a local build must agree on. */
const comparable = ({ level: _level, ciFatal: _ciFatal, ...rest }: Entry): string => JSON.stringify(rest);

const byCode = (entries: ReadonlyArray<Entry>, code: string): ReadonlyArray<Entry> =>
	entries.filter((e) => e.code === code);

describe("a CI build that fails on a CI-fatal API Extractor message", () => {
	it.effect(
		"fails, and records every diagnostic with its source location, as the local build does",
		() =>
			Effect.gen(function* () {
				const ciCwd = makePackage();
				const failure = yield* Effect.flip(build(ciCwd, true));
				assert.strictEqual(failure._tag, "BundlerError");

				const ci = readIssues(ciCwd);
				assert.strictEqual(ci.buildOk, false);
				assert.strictEqual(ci.failure?.name, "MetaGenerationError");

				// The CI-fatal entry is an error, with Run B's location: the reference site in the per-module declarations
				// (the line a local build records), never the location-less rollup copy CI used to write.
				const forgotten = byCode(ci.errors, "ae-forgotten-export");
				assert.strictEqual(forgotten.length, 1);
				assert.include(forgotten[0]?.text ?? "", "Hidden");
				assert.strictEqual(forgotten[0]?.level, "error");
				assert.isUndefined(forgotten[0]?.ciFatal);
				assert.match(forgotten[0]?.file ?? "", /dist\/prod\/npm\/declarations\/index\.d\.ts$/);
				assert.isNumber(forgotten[0]?.line);
				assert.deepStrictEqual(byCode(ci.warnings, "ae-forgotten-export"), []);

				// The non-fatal warning survives the failure, located too.
				const untagged = byCode(ci.warnings, "ae-missing-release-tag");
				assert.strictEqual(untagged.length, 1);
				assert.include(untagged[0]?.text ?? "", "untagged");
				assert.match(untagged[0]?.file ?? "", /src\/index\.ts$/);
				assert.isNumber(untagged[0]?.line);

				// The local build of the same tree records the same entries; only the levels differ.
				const localCwd = makePackage();
				yield* build(localCwd, false);
				const local = readIssues(localCwd);
				assert.strictEqual(local.buildOk, true);
				const all = (i: Issues): string[] => [...i.errors, ...i.warnings].map(comparable).sort();
				// The two copies live in different temporary roots, so compare package-relative locations.
				const relative = (cwd: string) => (s: string) => s.split(cwd).join("<pkg>");
				assert.deepStrictEqual(all(ci).map(relative(ciCwd)), all(local).map(relative(localCwd)));
				// API Extractor's suppressed bucket only: tsdown's TSGO notice is printed once per process, so only the
				// first of two builds in one test records it.
				const absorbed = (i: Issues, cwd: string): string[] =>
					i.suppressed
						.filter((e) => e.source === "api-extractor")
						.map(comparable)
						.map(relative(cwd))
						.sort();
				assert.deepStrictEqual(absorbed(ci, ciCwd), absorbed(local, localCwd));
			}),
		TIMEOUT,
	);
});
