// Ported from savvy-web/systems packages/tsdown-plugins/__test__/build/copy-public.test.ts on 2026-11-06
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { ConfigValidationError } from "../../src/errors.js";
import { copyPublicDir } from "../../src/passes/sync-public.js";

const root = "/ws/pkg";
const src = join(root, "public");
const out = join(root, "out", "pkg");

/** A volume holding `seed` and an existing (empty) out dir, and the copy run over it. */
const copy = (seed: MemoryFileSystemSeed, source: string = src) => {
	const handle = MemoryFileSystem.makeSync({ [out]: MemoryFileSystem.directory(), ...seed });
	return Effect.as(copyPublicDir(source, out).pipe(Effect.provide(handle.layer)), handle.volume);
};

describe("copyPublicDir", () => {
	it.effect("no-ops when the source does not exist", () =>
		Effect.gen(function* () {
			const volume = yield* copy({});
			assert.deepStrictEqual(volume.readDirectory(out), []);
		}),
	);

	// The volume resolves a relative path against its own root, not the process cwd, so this case alone runs on the
	// host disk, where `Path.resolve` and the reads agree on the process cwd.
	it.effect("accepts a source directory relative to the process cwd", () =>
		Effect.gen(function* () {
			const dir = mkdtempSync(join(tmpdir(), "copy-public-"));
			mkdirSync(join(dir, "public"), { recursive: true });
			writeFileSync(join(dir, "public", "a.txt"), "a", "utf-8");
			const target = join(dir, "out", "pkg");
			mkdirSync(target, { recursive: true });
			const prevCwd = process.cwd();
			process.chdir(dir);
			yield* copyPublicDir("public", target).pipe(
				Effect.provide(NodeServices.layer),
				Effect.ensuring(Effect.sync(() => process.chdir(prevCwd))),
			);
			assert.strictEqual(readFileSync(join(target, "a.txt"), "utf-8"), "a");
			rmSync(dir, { recursive: true, force: true });
		}),
	);

	it.effect("copies dotfiles, dot-directories and node_modules/ under public", () =>
		Effect.gen(function* () {
			const volume = yield* copy({
				[join(src, ".npmrc")]: "a",
				[join(src, ".well-known/security.txt")]: "b",
				[join(src, "node_modules/x/index.js")]: "c",
			});
			assert.strictEqual(volume.text(join(out, ".npmrc")), "a");
			assert.strictEqual(volume.text(join(out, ".well-known", "security.txt")), "b");
			assert.strictEqual(volume.text(join(out, "node_modules", "x", "index.js")), "c");
		}),
	);

	it.effect("flattens public/<path> to the out root (drops the public/ segment)", () =>
		Effect.gen(function* () {
			const volume = yield* copy({ [join(src, "ecma.json")]: "{}", [join(src, "tsconfig/action.json")]: "{ }" });
			assert.strictEqual(volume.text(join(out, "ecma.json")), "{}");
			assert.strictEqual(volume.text(join(out, "tsconfig/action.json")), "{ }");
			assert.strictEqual(volume.has(join(out, "public")), false);
		}),
	);

	it.effect("does NOT delete sibling files already in the out dir (additive)", () =>
		Effect.gen(function* () {
			const volume = yield* copy({ [join(out, "index.js")]: "export {};", [join(src, "ecma.json")]: "{}" });
			assert.strictEqual(volume.has(join(out, "index.js")), true);
			assert.strictEqual(volume.has(join(out, "ecma.json")), true);
		}),
	);

	it.effect("skips an identical prior copy without rewriting", () =>
		Effect.gen(function* () {
			const volume = yield* copy({
				[join(src, "ecma.json")]: "{}",
				[join(out, "ecma.json")]: MemoryFileSystem.file("{}", { mtime: 1 }),
			});
			assert.strictEqual(volume.text(join(out, "ecma.json")), "{}");
			assert.strictEqual(volume.mtime(join(out, "ecma.json")), 1);
		}),
	);

	it.effect("fails ConfigValidationError when a public path collides with a differing built output", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				copy({ [join(src, "index.js")]: "// public", [join(out, "index.js")]: "// built output" }),
			);
			assert.instanceOf(error, ConfigValidationError);
		}),
	);

	it.effect("fails ConfigValidationError when a public file collides with a built directory", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				copy({ [join(src, "foo")]: "public file", [join(out, "foo")]: MemoryFileSystem.directory() }),
			);
			assert.instanceOf(error, ConfigValidationError);
		}),
	);

	it.effect("fails ConfigValidationError when a nested public file collides with a built file at a parent path", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				copy({ [join(src, "foo/bar")]: "public nested", [join(out, "foo")]: "built file" }),
			);
			assert.instanceOf(error, ConfigValidationError);
		}),
	);
	it.effect("skips a public symlink loop, which the walk never lists, as the synchronous walk did", () =>
		Effect.gen(function* () {
			// On the host disk: a looping link stats ELOOP, so it is neither a file to copy nor a collision.
			const dir = mkdtempSync(join(tmpdir(), "copy-public-loop-"));
			mkdirSync(join(dir, "public"));
			mkdirSync(join(dir, "out"));
			symlinkSync("self", join(dir, "public", "self"));
			writeFileSync(join(dir, "public", "kept.txt"), "kept");
			yield* copyPublicDir(join(dir, "public"), join(dir, "out")).pipe(Effect.provide(NodeServices.layer));
			const copied = readdirSync(join(dir, "out")).sort();
			rmSync(dir, { recursive: true, force: true });
			assert.deepStrictEqual(copied, ["kept.txt"]);
		}),
	);
});
