import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { ImageFacts, ImageParseError } from "../src/index.js";
import { EXPECTED, fixture } from "./helpers.js";

const MIME: Record<string, string> = {
	png: "image/png",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
};
const factsOf = (facts: ImageFacts) => ({ format: facts.format, width: facts.width, height: facts.height });

describe("ImageFacts", () => {
	for (const [name, expected] of Object.entries(EXPECTED)) {
		it(`${name}: reads the oracle's facts and MIME type`, () => {
			const result = ImageFacts.fromBytesResult(fixture(name));
			assert.isTrue(Result.isSuccess(result));
			if (Result.isSuccess(result)) {
				assert.deepStrictEqual(factsOf(result.success), expected);
				assert.strictEqual(result.success.mimeType, MIME[expected.format]);
			}
		});

		it(`${name}: every prefix is a typed failure or the full facts, never malformed, never a throw`, () => {
			const bytes = fixture(name);
			for (let n = 0; n < bytes.length; n++) {
				const result = ImageFacts.fromBytesResult(bytes.subarray(0, n));
				if (Result.isSuccess(result)) {
					assert.deepStrictEqual(factsOf(result.success), expected, `${name} prefix ${n}`);
				} else {
					assert.notStrictEqual(
						result.failure.reason,
						"malformed",
						`${name} prefix ${n}: a prefix of a valid file is never malformed`,
					);
				}
			}
		});

		it.effect(`${name}: the Effect form agrees with the sync form`, () =>
			Effect.gen(function* () {
				const viaEffect = yield* ImageFacts.fromBytes(fixture(name));
				const viaResult = ImageFacts.fromBytesResult(fixture(name));
				assert.isTrue(
					Result.isSuccess(viaResult) &&
						viaResult.success.width === viaEffect.width &&
						viaResult.success.height === viaEffect.height,
				);
			}),
		);
	}

	it("reads a subarray view with a non-zero byteOffset (review focus 3)", () => {
		const png = fixture("png.png");
		const backing = new Uint8Array(png.length + 7);
		backing.set([1, 2, 3, 4, 5, 6, 7]);
		backing.set(png, 7);
		const result = ImageFacts.fromBytesResult(backing.subarray(7));
		assert.isTrue(Result.isSuccess(result) && result.success.width === 3 && result.success.height === 2);
	});

	it("unknown bytes are unrecognized with no format", () => {
		const result = ImageFacts.fromBytesResult(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"));
		assert.isTrue(Result.isFailure(result));
		if (Result.isFailure(result)) {
			assert.strictEqual(result.failure.reason, "unrecognized");
			assert.isFalse("format" in result.failure && result.failure.format !== undefined);
		}
	});

	it("a matched signature carries its format on the error, and the message names it", () => {
		const result = ImageFacts.fromBytesResult(fixture("png.png").subarray(0, 12));
		assert.isTrue(Result.isFailure(result));
		if (Result.isFailure(result)) {
			assert.strictEqual(result.failure.format, "png");
			assert.match(result.failure.message, /^Truncated png header/);
		}
	});

	it.effect("the Effect form fails on the typed channel", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(ImageFacts.fromBytes(new Uint8Array([0, 1, 2])));
			assert.instanceOf(error, ImageParseError);
			assert.strictEqual(error.reason, "unrecognized");
		}),
	);

	it.prop("never throws on arbitrary bytes", [Schema.Uint8Array], ([bytes]) => {
		ImageFacts.fromBytesResult(bytes);
	});

	const SIGNATURES: ReadonlyArray<ReadonlyArray<number>> = [
		[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
		[0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
		[0xff, 0xd8, 0xff],
		[0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
		[0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66],
	];
	it.prop(
		"never throws on any signature followed by arbitrary bytes",
		[Schema.Literals([0, 1, 2, 3, 4]), Schema.Uint8Array],
		([which, tail]) => {
			const signature = SIGNATURES[which] as ReadonlyArray<number>;
			const bytes = new Uint8Array(signature.length + tail.length);
			bytes.set(signature);
			bytes.set(tail, signature.length);
			ImageFacts.fromBytesResult(bytes);
		},
	);
});
