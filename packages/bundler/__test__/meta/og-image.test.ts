// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/og-image.test.ts on 2026-11-06
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, PlatformError } from "effect";
import type { WriteGeneratedOgImageOptions } from "../../src/meta/og-image.js";
import { OgGenerateError, resolveOgCacheSalt, writeGeneratedOgImage } from "../../src/meta/og-image.js";

/** A valid 1×1 opaque PNG. */
const PNG_1X1 = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
		"base64",
	),
);

/** A valid 1×1 baseline JPEG. */
const JPEG_1X1 = Uint8Array.from(
	Buffer.from(
		"/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
		"base64",
	),
);

const info = { name: "Pkg", packageName: "@scope/pkg", version: "1.0.0" };

/** The render writes on the host disk: the image cache's directory backend and the meta dir are real temp dirs. */
const write = (options: WriteGeneratedOgImageOptions) =>
	writeGeneratedOgImage(options).pipe(Effect.provide(NodeServices.layer));

/** The typed failure of a write that must fail. */
const failure = (options: WriteGeneratedOgImageOptions) => Effect.flip(write(options));

describe("writeGeneratedOgImage", () => {
	it.effect("writes og/<unscoped>.png under the meta dir and returns the sized image entry", () =>
		Effect.gen(function* () {
			const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
			const seen: Array<typeof info> = [];
			const image = yield* write({
				generate: async (i) => {
					seen.push(i);
					return PNG_1X1;
				},
				info,
				outMetaDir,
				unscopedName: "pkg",
			});
			assert.deepStrictEqual(image, { path: "og/pkg.png", type: "image/png", width: 1, height: 1 });
			assert.deepStrictEqual(seen, [info]);
			assert.deepStrictEqual(readFileSync(join(outMetaDir, "og", "pkg.png")), Buffer.from(PNG_1X1));
		}),
	);

	it.effect("fails an empty buffer with OgGenerateError and writes nothing", () =>
		Effect.gen(function* () {
			const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
			assert.instanceOf(
				yield* failure({ generate: async () => new Uint8Array(0), info, outMetaDir, unscopedName: "pkg" }),
				OgGenerateError,
			);
			assert.strictEqual(existsSync(join(outMetaDir, "og")), false);
		}),
	);

	it.effect("wraps a throwing generator, preserving the cause and naming the package", () =>
		Effect.gen(function* () {
			const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
			const cause = new Error("renderer exploded");
			const err = yield* failure({
				generate: async () => {
					throw cause;
				},
				info,
				outMetaDir,
				unscopedName: "pkg",
			});
			assert.instanceOf(err, OgGenerateError);
			assert.strictEqual(err.cause, cause);
			assert.strictEqual(err.packageName, "@scope/pkg");
			assert.include(err.message, "renderer exploded");
		}),
	);

	it.effect("fails an image type Open Graph consumers cannot render instead of mislabeling it", () =>
		Effect.gen(function* () {
			const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
			// A 1×1 GIF: a readable image, but outside the formats Open Graph consumers render.
			const gif = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
			const err = yield* failure({ generate: async () => gif, info, outMetaDir, unscopedName: "pkg" });
			assert.instanceOf(err, OgGenerateError);
			assert.include(err.message, "gif");
			assert.strictEqual(existsSync(join(outMetaDir, "og")), false);
		}),
	);

	it.effect("wraps a filesystem failure on the write as OgGenerateError", () =>
		Effect.gen(function* () {
			// A regular FILE where the meta dir should be: making "<file>/og" fails with ENOTDIR.
			const parent = mkdtempSync(join(tmpdir(), "og-"));
			const outMetaDir = join(parent, "not-a-dir");
			writeFileSync(outMetaDir, "");
			const err = yield* failure({ generate: async () => PNG_1X1, info, outMetaDir, unscopedName: "pkg" });
			assert.instanceOf(err, OgGenerateError);
			// The cause is the FileSystem service's PlatformError, which keeps the host errno as its own cause.
			assert.instanceOf(err.cause, PlatformError.PlatformError);
			const errno = (err.cause as PlatformError.PlatformError).cause as NodeJS.ErrnoException | undefined;
			assert.match(errno?.code ?? "", /ENOTDIR|EEXIST/);
		}),
	);

	it.effect("fails bytes that are not an image", () =>
		Effect.gen(function* () {
			const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
			assert.instanceOf(
				yield* failure({
					generate: async () => new TextEncoder().encode("definitely not an image"),
					info,
					outMetaDir,
					unscopedName: "pkg",
				}),
				OgGenerateError,
			);
		}),
	);

	it.effect("writes a JPEG under the .jpg extension with its image/jpeg MIME type", () =>
		Effect.gen(function* () {
			const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
			const image = yield* write({ generate: async () => JPEG_1X1, info, outMetaDir, unscopedName: "pkg" });
			assert.deepStrictEqual(image, { path: "og/pkg.jpg", type: "image/jpeg", width: 1, height: 1 });
			assert.strictEqual(existsSync(join(outMetaDir, "og", "pkg.jpg")), true);
		}),
	);
});

describe("writeGeneratedOgImage with a cache", () => {
	const counting = () => {
		let calls = 0;
		return {
			generate: async () => {
				calls++;
				return PNG_1X1;
			},
			calls: () => calls,
		};
	};

	it.effect("reuses the stored render for the same info and salt, still writing the output copy", () =>
		Effect.gen(function* () {
			const directory = mkdtempSync(join(tmpdir(), "og-cache-"));
			const gen = counting();
			const first = yield* write({
				generate: gen.generate,
				info,
				outMetaDir: mkdtempSync(join(tmpdir(), "og-")),
				unscopedName: "pkg",
				cache: { directory, salt: "v1" },
			});
			const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
			const second = yield* write({
				generate: gen.generate,
				info,
				outMetaDir,
				unscopedName: "pkg",
				cache: { directory, salt: "v1" },
			});
			assert.strictEqual(gen.calls(), 1);
			assert.deepStrictEqual(second, first);
			assert.deepStrictEqual(readFileSync(join(outMetaDir, "og", "pkg.png")), Buffer.from(PNG_1X1));
		}),
	);

	it.effect("misses when the salt or the info changes", () =>
		Effect.gen(function* () {
			const directory = mkdtempSync(join(tmpdir(), "og-cache-"));
			const gen = counting();
			const run = (salt: string, version: string) =>
				write({
					generate: gen.generate,
					info: { ...info, version },
					outMetaDir: mkdtempSync(join(tmpdir(), "og-")),
					unscopedName: "pkg",
					cache: { directory, salt },
				});
			yield* run("v1", "1.0.0");
			yield* run("v2", "1.0.0");
			yield* run("v2", "1.0.1");
			yield* run("v2", "1.0.1");
			assert.strictEqual(gen.calls(), 3);
		}),
	);

	it.effect("keys info whose optional fields are present but undefined", () =>
		Effect.gen(function* () {
			const directory = mkdtempSync(join(tmpdir(), "og-cache-"));
			const gen = counting();
			const sparse = { ...info, tagline: undefined, description: undefined, project: undefined };
			for (let i = 0; i < 2; i++) {
				yield* write({
					generate: gen.generate,
					info: sparse,
					outMetaDir: mkdtempSync(join(tmpdir(), "og-")),
					unscopedName: "pkg",
					cache: { directory, salt: "v1" },
				});
			}
			assert.strictEqual(gen.calls(), 1);
		}),
	);

	it.effect("treats a cache path it cannot use as a miss and still writes the image", () =>
		Effect.gen(function* () {
			// A regular FILE where the cache directory should be: every read and write fails with ENOTDIR.
			const directory = join(mkdtempSync(join(tmpdir(), "og-cache-")), "blocked");
			writeFileSync(directory, "");
			const gen = counting();
			const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
			const image = yield* write({
				generate: gen.generate,
				info,
				outMetaDir,
				unscopedName: "pkg",
				cache: { directory, salt: "v1" },
			});
			assert.deepStrictEqual(image, { path: "og/pkg.png", type: "image/png", width: 1, height: 1 });
			assert.deepStrictEqual(readFileSync(join(outMetaDir, "og", "pkg.png")), Buffer.from(PNG_1X1));
			assert.strictEqual(gen.calls(), 1);
		}),
	);

	it.effect.skipIf(process.getuid?.() === 0)("ignores a cache directory it cannot write", () =>
		Effect.gen(function* () {
			const parent = mkdtempSync(join(tmpdir(), "og-cache-"));
			chmodSync(parent, 0o555);
			const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
			const image = yield* write({
				generate: async () => PNG_1X1,
				info,
				outMetaDir,
				unscopedName: "pkg",
				cache: { directory: join(parent, "og"), salt: "v1" },
			}).pipe(Effect.ensuring(Effect.sync(() => chmodSync(parent, 0o755))));
			assert.strictEqual(image.path, "og/pkg.png");
			assert.strictEqual(existsSync(join(outMetaDir, "og", "pkg.png")), true);
		}),
	);

	it.effect("still fails a rejected render when the cache is unusable", () =>
		Effect.gen(function* () {
			const directory = join(mkdtempSync(join(tmpdir(), "og-cache-")), "blocked");
			writeFileSync(directory, "");
			assert.instanceOf(
				yield* failure({
					generate: async () => new Uint8Array(0),
					info,
					outMetaDir: mkdtempSync(join(tmpdir(), "og-")),
					unscopedName: "pkg",
					cache: { directory, salt: "v1" },
				}),
				OgGenerateError,
			);
		}),
	);

	it.effect("never stores a rejected render", () =>
		Effect.gen(function* () {
			const directory = mkdtempSync(join(tmpdir(), "og-cache-"));
			assert.instanceOf(
				yield* failure({
					generate: async () => new Uint8Array(0),
					info,
					outMetaDir: mkdtempSync(join(tmpdir(), "og-")),
					unscopedName: "pkg",
					cache: { directory, salt: "v1" },
				}),
				OgGenerateError,
			);
			assert.deepStrictEqual(readdirSync(directory), []);
		}),
	);
});

describe("resolveOgCacheSalt", () => {
	const plain = async () => PNG_1X1;
	const salted = Object.assign(async () => PNG_1X1, { cacheSalt: "builtin" });

	it("uses an explicit string over the generator's own salt", () => {
		assert.strictEqual(resolveOgCacheSalt(salted, "mine"), "mine");
		assert.strictEqual(resolveOgCacheSalt(plain, "mine"), "mine");
	});

	it("falls back to the generator's own salt when none is configured", () => {
		assert.strictEqual(resolveOgCacheSalt(salted, undefined), "builtin");
	});

	it("does not cache a generator with no salt of its own unless configured", () => {
		assert.isUndefined(resolveOgCacheSalt(plain, undefined));
	});

	it("disables the cache with false, even for a salted generator", () => {
		assert.isUndefined(resolveOgCacheSalt(salted, false));
	});
});
