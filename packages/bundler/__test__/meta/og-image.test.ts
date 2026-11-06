// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/og-image.test.ts on 2026-11-06
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
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

describe("writeGeneratedOgImage", () => {
	it("writes og/<unscoped>.png under the meta dir and returns the sized image entry", async () => {
		const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
		const seen: Array<typeof info> = [];
		const image = await writeGeneratedOgImage({
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
	});

	it("rejects an empty buffer with OgGenerateError and writes nothing", async () => {
		const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
		assert.instanceOf(
			await writeGeneratedOgImage({
				generate: async () => new Uint8Array(0),
				info,
				outMetaDir,
				unscopedName: "pkg",
			}).then(
				() => undefined,
				(e: unknown) => e,
			),
			OgGenerateError,
		);
		assert.strictEqual(existsSync(join(outMetaDir, "og")), false);
	});

	it("wraps a throwing generator, preserving the cause and naming the package", async () => {
		const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
		const cause = new Error("renderer exploded");
		const err = await writeGeneratedOgImage({
			generate: async () => {
				throw cause;
			},
			info,
			outMetaDir,
			unscopedName: "pkg",
		}).catch((e: unknown) => e);
		assert.instanceOf(err, OgGenerateError);
		assert.strictEqual((err as OgGenerateError).cause, cause);
		assert.strictEqual((err as OgGenerateError).packageName, "@scope/pkg");
		assert.include((err as OgGenerateError).message, "renderer exploded");
	});

	it("rejects an image type Open Graph consumers cannot render instead of mislabeling it", async () => {
		const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
		// A 1×1 GIF: a readable image, but outside the formats Open Graph consumers render.
		const gif = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
		const err = await writeGeneratedOgImage({ generate: async () => gif, info, outMetaDir, unscopedName: "pkg" }).catch(
			(e: unknown) => e,
		);
		assert.instanceOf(err, OgGenerateError);
		assert.include((err as OgGenerateError).message, "gif");
		assert.strictEqual(existsSync(join(outMetaDir, "og")), false);
	});

	it("wraps a filesystem failure on the write as OgGenerateError", async () => {
		// A regular FILE where the meta dir should be: mkdirSync("<file>/og") fails with ENOTDIR.
		const parent = mkdtempSync(join(tmpdir(), "og-"));
		const outMetaDir = join(parent, "not-a-dir");
		writeFileSync(outMetaDir, "");
		const err = await writeGeneratedOgImage({
			generate: async () => PNG_1X1,
			info,
			outMetaDir,
			unscopedName: "pkg",
		}).catch((e: unknown) => e);
		assert.instanceOf(err, OgGenerateError);
		assert.match(((err as OgGenerateError).cause as NodeJS.ErrnoException).code ?? "", /ENOTDIR|EEXIST/);
	});

	it("rejects bytes that are not an image", async () => {
		const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
		assert.instanceOf(
			await writeGeneratedOgImage({
				generate: async () => new TextEncoder().encode("definitely not an image"),
				info,
				outMetaDir,
				unscopedName: "pkg",
			}).then(
				() => undefined,
				(e: unknown) => e,
			),
			OgGenerateError,
		);
	});

	it("writes a JPEG under the .jpg extension with its image/jpeg MIME type", async () => {
		const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
		const image = await writeGeneratedOgImage({
			generate: async () => JPEG_1X1,
			info,
			outMetaDir,
			unscopedName: "pkg",
		});
		assert.deepStrictEqual(image, { path: "og/pkg.jpg", type: "image/jpeg", width: 1, height: 1 });
		assert.strictEqual(existsSync(join(outMetaDir, "og", "pkg.jpg")), true);
	});
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

	it("reuses the stored render for the same info and salt, still writing the output copy", async () => {
		const directory = mkdtempSync(join(tmpdir(), "og-cache-"));
		const gen = counting();
		const first = await writeGeneratedOgImage({
			generate: gen.generate,
			info,
			outMetaDir: mkdtempSync(join(tmpdir(), "og-")),
			unscopedName: "pkg",
			cache: { directory, salt: "v1" },
		});
		const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
		const second = await writeGeneratedOgImage({
			generate: gen.generate,
			info,
			outMetaDir,
			unscopedName: "pkg",
			cache: { directory, salt: "v1" },
		});
		assert.strictEqual(gen.calls(), 1);
		assert.deepStrictEqual(second, first);
		assert.deepStrictEqual(readFileSync(join(outMetaDir, "og", "pkg.png")), Buffer.from(PNG_1X1));
	});

	it("misses when the salt or the info changes", async () => {
		const directory = mkdtempSync(join(tmpdir(), "og-cache-"));
		const gen = counting();
		const run = (salt: string, version: string) =>
			writeGeneratedOgImage({
				generate: gen.generate,
				info: { ...info, version },
				outMetaDir: mkdtempSync(join(tmpdir(), "og-")),
				unscopedName: "pkg",
				cache: { directory, salt },
			});
		await run("v1", "1.0.0");
		await run("v2", "1.0.0");
		await run("v2", "1.0.1");
		await run("v2", "1.0.1");
		assert.strictEqual(gen.calls(), 3);
	});

	it("keys info whose optional fields are present but undefined", async () => {
		const directory = mkdtempSync(join(tmpdir(), "og-cache-"));
		const gen = counting();
		const sparse = { ...info, tagline: undefined, description: undefined, project: undefined };
		for (let i = 0; i < 2; i++) {
			await writeGeneratedOgImage({
				generate: gen.generate,
				info: sparse,
				outMetaDir: mkdtempSync(join(tmpdir(), "og-")),
				unscopedName: "pkg",
				cache: { directory, salt: "v1" },
			});
		}
		assert.strictEqual(gen.calls(), 1);
	});

	it("treats a cache path it cannot use as a miss and still writes the image", async () => {
		// A regular FILE where the cache directory should be: every read and write fails with ENOTDIR.
		const directory = join(mkdtempSync(join(tmpdir(), "og-cache-")), "blocked");
		writeFileSync(directory, "");
		const gen = counting();
		const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
		const image = await writeGeneratedOgImage({
			generate: gen.generate,
			info,
			outMetaDir,
			unscopedName: "pkg",
			cache: { directory, salt: "v1" },
		});
		assert.deepStrictEqual(image, { path: "og/pkg.png", type: "image/png", width: 1, height: 1 });
		assert.deepStrictEqual(readFileSync(join(outMetaDir, "og", "pkg.png")), Buffer.from(PNG_1X1));
		assert.strictEqual(gen.calls(), 1);
	});

	it.skipIf(process.getuid?.() === 0)("ignores a cache directory it cannot write", async () => {
		const parent = mkdtempSync(join(tmpdir(), "og-cache-"));
		chmodSync(parent, 0o555);
		try {
			const outMetaDir = mkdtempSync(join(tmpdir(), "og-"));
			const image = await writeGeneratedOgImage({
				generate: async () => PNG_1X1,
				info,
				outMetaDir,
				unscopedName: "pkg",
				cache: { directory: join(parent, "og"), salt: "v1" },
			});
			assert.strictEqual(image.path, "og/pkg.png");
			assert.strictEqual(existsSync(join(outMetaDir, "og", "pkg.png")), true);
		} finally {
			chmodSync(parent, 0o755);
		}
	});

	it("still fails a rejected render when the cache is unusable", async () => {
		const directory = join(mkdtempSync(join(tmpdir(), "og-cache-")), "blocked");
		writeFileSync(directory, "");
		assert.instanceOf(
			await writeGeneratedOgImage({
				generate: async () => new Uint8Array(0),
				info,
				outMetaDir: mkdtempSync(join(tmpdir(), "og-")),
				unscopedName: "pkg",
				cache: { directory, salt: "v1" },
			}).then(
				() => undefined,
				(e: unknown) => e,
			),
			OgGenerateError,
		);
	});

	it("never stores a rejected render", async () => {
		const directory = mkdtempSync(join(tmpdir(), "og-cache-"));
		assert.instanceOf(
			await writeGeneratedOgImage({
				generate: async () => new Uint8Array(0),
				info,
				outMetaDir: mkdtempSync(join(tmpdir(), "og-")),
				unscopedName: "pkg",
				cache: { directory, salt: "v1" },
			}).then(
				() => undefined,
				(e: unknown) => e,
			),
			OgGenerateError,
		);
		assert.deepStrictEqual(readdirSync(directory), []);
	});
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
