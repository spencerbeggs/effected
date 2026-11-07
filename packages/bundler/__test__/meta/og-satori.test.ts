// Ported from savvy-web/systems packages/bundler/__test__/og.test.ts on 2026-11-06

import { assert, describe, it } from "@effect/vitest";
import { ImageFacts } from "@effected/images";
import { Result } from "effect";
import { vi } from "vitest";

const info = { name: "Kitchen Sink", packageName: "@modules/kitchensink", version: "1.0.0", tagline: "Every shape" };

describe("ogImage.satori", () => {
	it("renders a 1200×630 PNG with the bundled Inter font", async () => {
		const { ogImage } = await import("../../src/meta/og-satori.js");
		const bytes = await ogImage.satori()(info);
		assert.instanceOf(bytes, Uint8Array);
		assert.containSubset(Result.getOrThrow(ImageFacts.fromBytesResult(bytes)), {
			format: "png",
			width: 1200,
			height: 630,
		});
	});

	it("carries a cache salt naming its version, both peers' versions and its colors", async () => {
		const { ogImage } = await import("../../src/meta/og-satori.js");
		const salt = JSON.parse(ogImage.satori().cacheSalt ?? "{}");
		assert.strictEqual(salt.renderer, "@effected/bundler/og#satori");
		assert.match(salt.satori, /^\d+\.\d+\.\d+/);
		assert.match(salt.resvg, /^\d+\.\d+\.\d+/);
		assert.strictEqual(ogImage.satori().cacheSalt, ogImage.satori().cacheSalt);
		assert.notStrictEqual(ogImage.satori({ accent: "#ff0000" }).cacheSalt, ogImage.satori().cacheSalt);
	});

	it("rejects with a message naming both optional peers when satori cannot load", async () => {
		vi.resetModules();
		vi.doMock("satori", () => {
			throw new Error("Cannot find module 'satori'");
		});
		try {
			const { ogImage } = await import("../../src/meta/og-satori.js");
			assert.match(
				String(
					await ogImage
						.satori()(info)
						.then(
							() => undefined,
							(e: unknown) => e,
						),
				),
				/satori.*@resvg\/resvg-js/,
			);
		} finally {
			vi.doUnmock("satori");
			vi.resetModules();
		}
	});
});
