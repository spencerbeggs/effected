import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, vi } from "vitest";
import { subtle, toArrayBuffer } from "../src/internal/subtle.js";

describe("subtle", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.effect("yields the runtime's SubtleCrypto", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* subtle, globalThis.crypto.subtle);
		}),
	);

	it.effect("fails with unsupportedRuntime when globalThis.crypto is absent", () =>
		Effect.gen(function* () {
			vi.stubGlobal("crypto", undefined);
			const error = yield* Effect.flip(subtle);
			assert.strictEqual(error.reason, "unsupportedRuntime");
		}),
	);

	it("copies exactly the view's bytes into a fresh ArrayBuffer", () => {
		const backing = new Uint8Array([9, 1, 2, 3, 9]);
		const buffer = toArrayBuffer(backing.subarray(1, 4));
		assert.strictEqual(buffer.byteLength, 3);
		assert.deepStrictEqual(new Uint8Array(buffer), new Uint8Array([1, 2, 3]));
		assert.notStrictEqual(buffer, backing.buffer);
	});
});
