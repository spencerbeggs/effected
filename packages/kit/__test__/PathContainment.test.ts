import { assert, describe, layer } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path } from "effect";
import { PathContainment } from "../src/PathContainment.js";

const Env = Layer.merge(
	Path.layer,
	MemoryFileSystem.layerWith({
		"/repo/a.json": "{}",
		"/repo/out": MemoryFileSystem.symlink("/etc"),
		"/etc/x": "",
		"/link": MemoryFileSystem.symlink("/repo"),
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
});
