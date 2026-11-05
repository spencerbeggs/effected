import { assert, describe, layer } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path, PlatformError } from "effect";
import { PathContainment } from "../src/PathContainment.js";

const Env = Layer.merge(
	Path.layer,
	MemoryFileSystem.layerWith({
		"/repo/a.json": "{}",
		"/repo/out": MemoryFileSystem.symlink("/etc"),
		"/etc/x": "",
		"/link": MemoryFileSystem.symlink("/repo"),
		"/repo/evil": MemoryFileSystem.symlink("/etc/cron.d/evil"),
		"/repo/dangdir": MemoryFileSystem.symlink("/nowhere"),
		"/repo/loop-a": MemoryFileSystem.symlink("/repo/loop-b"),
		"/repo/loop-b": MemoryFileSystem.symlink("/repo/loop-a"),
		"/repo/inner": MemoryFileSystem.symlink("/repo/dest"),
		"/repo/dest/f": "",
		"/repo/d": MemoryFileSystem.symlink("/etc/sub"),
		"/etc/sub/dang": MemoryFileSystem.symlink("../inside"),
	}),
);

describe("PathContainment", () => {
	layer(Path.layer)((it) => {
		it.effect("the root contains itself and its children", () =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				assert.isTrue(PathContainment.isWithinLexical(path, "/repo", "/repo"));
				assert.isTrue(PathContainment.isWithinLexical(path, "/repo", "/repo/a"));
			}),
		);
		it.effect("a sibling sharing a prefix is outside", () =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				assert.isFalse(PathContainment.isWithinLexical(path, "/repo", "/repo-other/a"));
			}),
		);
		it.effect("a dot-dot escape is outside", () =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				assert.isFalse(PathContainment.isWithinLexical(path, "/repo", "/repo/../etc"));
			}),
		);
		it.effect("trailing separators don't matter", () =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				assert.isTrue(PathContainment.isWithinLexical(path, "/repo/", "/repo/a"));
				assert.isTrue(PathContainment.isWithinLexical(path, "/repo", "/repo/a/"));
			}),
		);
	});

	layer(Env)((it) => {
		it.effect("a symlinked root contains its own children", () =>
			Effect.gen(function* () {
				assert.isTrue(yield* PathContainment.isWithin("/link", "/repo/a.json"));
			}),
		);
		it.effect("a symlink inside root pointing out is outside", () =>
			Effect.gen(function* () {
				assert.isFalse(yield* PathContainment.isWithin("/repo", "/repo/out/x"));
			}),
		);
		it.effect("a candidate that doesn't exist resolves through its nearest existing parent", () =>
			Effect.gen(function* () {
				assert.isTrue(yield* PathContainment.isWithin("/repo", "/repo/new/b.json"));
				assert.isFalse(yield* PathContainment.isWithin("/repo", "/repo/out/new/b.json"));
			}),
		);
		it.effect("the candidate itself an outward symlink to an existing target is outside", () =>
			Effect.gen(function* () {
				assert.isFalse(yield* PathContainment.isWithin("/repo", "/repo/out"));
			}),
		);
		it.effect("a dangling link as the candidate is followed out, not read as absent", () =>
			Effect.gen(function* () {
				assert.isFalse(yield* PathContainment.isWithin("/repo", "/repo/evil"));
			}),
		);
		it.effect("a dangling link with a tail beneath it is outside", () =>
			Effect.gen(function* () {
				assert.isFalse(yield* PathContainment.isWithin("/repo", "/repo/dangdir/new/b.json"));
			}),
		);
		it.effect("a link staying inside the root (even to a missing tail) is inside", () =>
			Effect.gen(function* () {
				assert.isTrue(yield* PathContainment.isWithin("/repo", "/repo/inner/f"));
				assert.isTrue(yield* PathContainment.isWithin("/repo", "/repo/inner/new/b"));
			}),
		);
		it.effect("a relative dangling target resolves against the canonical parent, not an outward-link spelling", () =>
			Effect.gen(function* () {
				// /repo/d -> /etc/sub, and /etc/sub/dang -> ../inside: the OS lands on /etc/inside.
				assert.isFalse(yield* PathContainment.isWithin("/repo", "/repo/d/dang"));
				assert.isFalse(yield* PathContainment.isWithin("/repo", "/repo/d/dang/new"));
			}),
		);
		it.effect("a symlink loop is outside", () =>
			Effect.gen(function* () {
				assert.isFalse(yield* PathContainment.isWithin("/repo", "/repo/loop-a"));
				assert.isFalse(yield* PathContainment.isWithin("/repo", "/repo/loop-a/x"));
			}),
		);
		it.effect("a relative candidate resolves against the root, not the working directory", () =>
			Effect.gen(function* () {
				assert.isTrue(yield* PathContainment.isWithin("/repo", "a.json"));
				assert.isTrue(yield* PathContainment.isWithin("/repo", "new/b.json"));
				assert.isFalse(yield* PathContainment.isWithin("/repo", "../etc/x"));
				assert.isFalse(yield* PathContainment.isWithin("/repo", "out/x"));
			}),
		);
		it.effect("a dot-dot escape is outside through the effectful form too", () =>
			Effect.gen(function* () {
				assert.isFalse(yield* PathContainment.isWithin("/repo", "/repo/../etc/x"));
			}),
		);
	});

	layer(Layer.merge(Path.layer, MemoryFileSystem.layer))((it) => {
		it.effect("falls back to the lexical answer when the root's realpath can't be read", () =>
			Effect.gen(function* () {
				assert.isTrue(yield* PathContainment.isWithin("/missing", "/missing/a"));
				assert.isFalse(yield* PathContainment.isWithin("/missing", "/other/a"));
			}),
		);
	});

	layer(Path.layer)((it) => {
		const denied = (method: string, path: string) =>
			PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method, pathOrDescriptor: path });
		const seed = { "/repo/locked/f": "", "/repo/a.json": "{}" };

		it.effect("a non-NotFound failure on a candidate component answers false", () =>
			Effect.gen(function* () {
				const result = yield* PathContainment.isWithin("/repo", "/repo/locked/new").pipe(
					Effect.provide(
						MemoryFileSystem.layerWith(seed, {
							faults: { realPath: (p) => (p === "/repo/locked/new" ? Effect.fail(denied("realPath", p)) : undefined) },
						}),
					),
				);
				assert.isFalse(result);
			}),
		);
		it.effect("a non-NotFound failure reading the root's real path answers false, not the lexical answer", () =>
			Effect.gen(function* () {
				const result = yield* PathContainment.isWithin("/repo", "/repo/a.json").pipe(
					Effect.provide(
						MemoryFileSystem.layerWith(seed, {
							faults: { realPath: (p) => (p === "/repo" ? Effect.fail(denied("realPath", p)) : undefined) },
						}),
					),
				);
				assert.isFalse(result);
			}),
		);
	});
});
