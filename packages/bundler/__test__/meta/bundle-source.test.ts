// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/bundle-source.test.ts on 2026-11-06
import { join, relative as relativePath } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import type { BundleManifestSources } from "../../src/meta/bundle-source.js";
import { BundleManifestSourceError, loadBundleManifestSources } from "../../src/meta/bundle-source.js";

// WorkspaceDiscovery walks the provided FileSystem, so a memfs volume stands in for the disk.
const lonely = "/tmp/lonely";
const r = "/ws/root";
const pkg = join(r, "packages", "pkg");

/** A standalone package directory: just a manifest. */
const lonelySeed = (extra: MemoryFileSystemSeed = {}, manifest: object = { name: "lonely" }): MemoryFileSystemSeed => ({
	[join(lonely, "package.json")]: JSON.stringify(manifest),
	...extra,
});

/** A workspace root with one member, `packages/pkg`. */
const workspaceSeed = (extra: MemoryFileSystemSeed = {}): MemoryFileSystemSeed => ({
	// A version-less private root is a legal member as of @effected/workspaces 0.19.0; declare a version
	// anyway so these fixtures describe an ordinary, fully-formed workspace.
	[join(r, "package.json")]: JSON.stringify({ name: "root", version: "0.0.0", private: true }),
	[join(r, "pnpm-workspace.yaml")]: 'packages:\n  - "packages/*"\n',
	[join(pkg, "package.json")]: JSON.stringify({ name: "@scope/pkg", version: "1.0.0" }),
	...extra,
});

const load = (seed: MemoryFileSystemSeed, cwd: string): Effect.Effect<BundleManifestSources, unknown> =>
	loadBundleManifestSources(cwd).pipe(Effect.provide(MemoryFileSystem.makeSync(seed).layer));

describe("loadBundleManifestSources", () => {
	it.effect("returns both tiers undefined when no file exists", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* load(lonelySeed(), lonely), { leaf: undefined, project: undefined });
		}),
	);

	it.effect("reads the leaf tier alone outside any workspace", () =>
		Effect.gen(function* () {
			const seed = lonelySeed({ [join(lonely, "bundle.json")]: JSON.stringify({ name: "Lonely", tagline: "alone" }) });
			assert.deepStrictEqual(yield* load(seed, lonely), {
				leaf: { name: "Lonely", tagline: "alone" },
				project: undefined,
			});
		}),
	);

	it.effect("reads the project tier from the workspace root", () =>
		Effect.gen(function* () {
			const seed = workspaceSeed({
				[join(pkg, "bundle.json")]: JSON.stringify({ name: "Leaf" }),
				[join(r, "bundle.json")]: JSON.stringify({ name: "Project", tagline: "root tag" }),
			});
			assert.deepStrictEqual(yield* load(seed, pkg), {
				leaf: { name: "Leaf" },
				project: { name: "Project", tagline: "root tag" },
			});
		}),
	);

	it.effect("ignores stray spec and project keys in a source file", () =>
		Effect.gen(function* () {
			const seed = lonelySeed({
				[join(lonely, "bundle.json")]: JSON.stringify({ spec: 1, project: { name: "X" }, name: "Y" }),
			});
			assert.deepStrictEqual((yield* load(seed, lonely)).leaf, { name: "Y" });
		}),
	);

	it.effect("fails BundleManifestSourceError for a present but invalid leaf", () =>
		Effect.gen(function* () {
			const seed = lonelySeed({ [join(lonely, "bundle.json")]: "{ not json" });
			const err = yield* Effect.flip(load(seed, lonely));
			assert.instanceOf(err, BundleManifestSourceError);
			assert.strictEqual((err as BundleManifestSourceError).path.endsWith("bundle.json"), true);
		}),
	);

	it.effect("fails BundleManifestSourceError for a leaf that parses but fails the schema", () =>
		Effect.gen(function* () {
			const seed = lonelySeed({ [join(lonely, "bundle.json")]: JSON.stringify({ openGraph: { images: [{}] } }) });
			const err = yield* Effect.flip(load(seed, lonely));
			assert.instanceOf(err, BundleManifestSourceError);
		}),
	);

	it.effect("does not double-count the root file when cwd is a relative or symlinked spelling of the root", () =>
		Effect.gen(function* () {
			const link = "/elsewhere/link";
			const seed = workspaceSeed({
				[join(r, "bundle.json")]: JSON.stringify({
					name: "Root",
					openGraph: { images: [{ url: "https://x/og.png" }] },
				}),
				[link]: MemoryFileSystem.symlink(r),
			});
			const relative = relativePath(process.cwd(), r);
			for (const cwd of [link, relative, `${r}/.`]) {
				assert.deepStrictEqual(
					yield* load(seed, cwd),
					{
						leaf: { name: "Root", openGraph: { images: [{ url: "https://x/og.png" }] } },
						project: undefined,
					},
					cwd,
				);
			}
		}),
	);

	it.effect("surfaces a workspace-discovery failure instead of silently dropping the project tier", () =>
		Effect.gen(function* () {
			// A member manifest with no name is one discovery failure; the leaf still reads. (A member with
			// no VERSION is not: @effected/workspaces 0.19.0 retired the missingVersion kind, because pnpm
			// accepts a version-less private package.)
			const seed = workspaceSeed({
				[join(pkg, "package.json")]: JSON.stringify({ version: "1.0.0" }),
				[join(r, "bundle.json")]: JSON.stringify({ name: "Project" }),
				[join(pkg, "bundle.json")]: JSON.stringify({ name: "Leaf" }),
			});
			const sources = yield* load(seed, pkg);
			assert.deepStrictEqual(sources.leaf, { name: "Leaf" });
			assert.isUndefined(sources.project);
			assert.match(sources.discoveryFailure ?? "", /missingName/);
		}),
	);

	it.effect("reports no discovery failure for a package outside any workspace", () =>
		Effect.gen(function* () {
			const seed = lonelySeed({}, { name: "lonely", version: "1.0.0" });
			assert.deepStrictEqual(yield* load(seed, lonely), { leaf: undefined, project: undefined });
		}),
	);

	it.effect("reports a retired tsdoctor.json at the leaf tier without reading it", () =>
		Effect.gen(function* () {
			// Unparseable on purpose: a loader that read the retired file would fail BundleManifestSourceError.
			const seed = lonelySeed({ [join(lonely, "tsdoctor.json")]: "{ not json" });
			assert.deepStrictEqual(yield* load(seed, lonely), {
				leaf: undefined,
				project: undefined,
				retiredSources: [join(lonely, "tsdoctor.json")],
			});
		}),
	);

	it.effect("reports a retired tsdoctor.json at the project tier, beside a current leaf", () =>
		Effect.gen(function* () {
			const seed = workspaceSeed({
				[join(pkg, "bundle.json")]: JSON.stringify({ name: "Leaf" }),
				[join(r, "tsdoctor.json")]: JSON.stringify({ name: "Project" }),
			});
			assert.deepStrictEqual(yield* load(seed, pkg), {
				leaf: { name: "Leaf" },
				project: undefined,
				retiredSources: [join(r, "tsdoctor.json")],
			});
		}),
	);

	it.effect("reports nothing retired at a tier whose bundle.json is present", () =>
		Effect.gen(function* () {
			const seed = workspaceSeed({
				[join(r, "bundle.json")]: JSON.stringify({ name: "Project" }),
				[join(r, "tsdoctor.json")]: JSON.stringify({ name: "Stale" }),
			});
			const sources = yield* load(seed, pkg);
			assert.deepStrictEqual(sources.project, { name: "Project" });
			assert.notProperty(sources, "retiredSources");
		}),
	);

	it.effect("reads a file at a package that IS the workspace root once, as the leaf", () =>
		Effect.gen(function* () {
			const seed = workspaceSeed({ [join(r, "bundle.json")]: JSON.stringify({ name: "Root" }) });
			assert.deepStrictEqual(yield* load(seed, r), { leaf: { name: "Root" }, project: undefined });
		}),
	);
});
