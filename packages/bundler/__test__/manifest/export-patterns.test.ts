import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemHandle } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import type { UnmatchedExportPatternsOptions } from "../../src/manifest/export-patterns.js";
import { unmatchedExportPatterns } from "../../src/manifest/export-patterns.js";

/** A package directory in its own volume, holding a manifest with `exportsMap` and each of `files`. */
const pkgWith = (
	exportsMap: unknown,
	files: ReadonlyArray<string> = [],
): { readonly handle: MemoryFileSystemHandle; readonly pkg: string } => {
	const pkg = "/ws/pkg";
	const handle = MemoryFileSystem.makeSync({ [join(pkg, "package.json")]: JSON.stringify({ exports: exportsMap }) });
	for (const file of files) handle.write(join(pkg, file), "{}");
	return { handle, pkg };
};

const unmatched = (
	{ handle, pkg }: { readonly handle: MemoryFileSystemHandle; readonly pkg: string },
	options?: UnmatchedExportPatternsOptions,
) => unmatchedExportPatterns(pkg, options).pipe(Effect.provide(handle.layer));

const PATTERN = { "./schemas/*.json": "./schemas/*.json" };

describe("unmatchedExportPatterns", () => {
	it.effect("names a pattern with nothing behind it, and passes one with a nested match", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* unmatched(pkgWith(PATTERN)), [
				{ field: "exports", key: "./schemas/*.json", target: "./schemas/*.json" },
			]);
			assert.deepStrictEqual(yield* unmatched(pkgWith(PATTERN, ["schemas/5.0/run.json"])), []);
		}),
	);

	it.effect(
		"reads a target under conditions, ignores a null exclusion, and names a literal target that is not a file",
		() =>
			Effect.gen(function* () {
				const subject = pkgWith({
					"./a/*": { types: "./a/*.d.ts", default: "./a/*.js" },
					"./internal/*": null,
					".": "./missing.js",
				});
				assert.deepStrictEqual(yield* unmatched(subject), [
					{ field: "exports", key: ".", target: "./missing.js" },
					{ field: "exports", key: "./a/*", target: "./a/*.d.ts" },
					{ field: "exports", key: "./a/*", target: "./a/*.js" },
				]);
			}),
	);

	it.effect("passes a literal target that is a file, and skips a folder mapping and an ignored target (#1259)", () =>
		Effect.gen(function* () {
			const subject = pkgWith(
				{
					".": { types: "./index.d.ts", import: "./index.js" },
					"./package.json": "./package.json",
					"./dir/": "./dir/",
					"./bin": "./bin/tool-darwin-arm64",
					"./foo": "./dist/foo.js",
				},
				["index.d.ts", "index.js"],
			);
			assert.deepStrictEqual(yield* unmatched(subject, { ignore: ["./bin/tool-darwin-arm64"] }), [
				{ field: "exports", key: "./foo", target: "./dist/foo.js" },
			]);
		}),
	);

	it.effect("names a bin target that is not a file, and skips an ignored one in either path form", () =>
		Effect.gen(function* () {
			const subject = pkgWith({}, ["bin/cli.js"]);
			const manifest = join(subject.pkg, "package.json");
			subject.handle.write(
				manifest,
				JSON.stringify({ bin: { cli: "bin/cli.js", gone: "bin/gone.js", tool: "bin/tool-darwin-arm64" } }),
			);
			assert.deepStrictEqual(yield* unmatched(subject, { ignore: ["./bin/tool-darwin-arm64"] }), [
				{ field: "bin", key: "gone", target: "bin/gone.js" },
			]);
			subject.handle.write(manifest, JSON.stringify({ bin: "bin/missing.js" }));
			assert.deepStrictEqual(yield* unmatched(subject), [{ field: "bin", key: "bin", target: "bin/missing.js" }]);
		}),
	);

	it.effect("counts a symlinked file as a match, and a dangling link or a directory as none", () =>
		Effect.gen(function* () {
			const linked = pkgWith(PATTERN);
			linked.handle.write("/elsewhere/run.json", "{}");
			linked.handle.symlink("/elsewhere/run.json", join(linked.pkg, "schemas", "run.json"));
			assert.deepStrictEqual(yield* unmatched(linked), []);

			const dangling = pkgWith(PATTERN);
			dangling.handle.symlink(join(dangling.pkg, "gone.json"), join(dangling.pkg, "schemas", "run.json"));
			dangling.handle.mkdir(join(dangling.pkg, "schemas", "dir.json"));
			assert.lengthOf(yield* unmatched(dangling), 1);
		}),
	);

	it.effect("names a literal target under a file, which the old stat threw on (ENOTDIR), rather than failing", () =>
		Effect.gen(function* () {
			const subject = pkgWith({ "./sub": "./index.js/sub" }, ["index.js"]);
			assert.deepStrictEqual(yield* unmatched(subject), [{ field: "exports", key: "./sub", target: "./index.js/sub" }]);
		}),
	);

	it.effect("has nothing to say about a package with no readable manifest", () =>
		Effect.gen(function* () {
			const empty = { handle: MemoryFileSystem.makeSync(), pkg: "/no-such-package-dir" };
			assert.deepStrictEqual(yield* unmatched(empty), []);
			const unparseable = { handle: MemoryFileSystem.makeSync({ "/ws/pkg/package.json": "{ nope" }), pkg: "/ws/pkg" };
			assert.deepStrictEqual(yield* unmatched(unparseable), []);
		}),
	);
});
