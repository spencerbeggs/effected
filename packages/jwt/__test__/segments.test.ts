import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import * as Base64Url from "effect/encoding/Base64Url";
import { appendSignature, joinCompact, splitCompact } from "../src/internal/segments.js";

const reasonOf = (token: string): string | undefined => {
	const parsed = splitCompact(token);
	return Result.isFailure(parsed) ? parsed.failure.reason : undefined;
};

const json = (value: unknown): string => Base64Url.encode(JSON.stringify(value));

describe("segments", () => {
	it("round-trips header and payload", () => {
		const { signingInput } = joinCompact({ alg: "RS256", typ: "JWT" }, { sub: "a-_b?>" });
		const token = appendSignature(signingInput, new Uint8Array([1, 2, 3]));
		const parsed = splitCompact(token);
		assert.isTrue(Result.isSuccess(parsed));
		if (Result.isSuccess(parsed)) {
			assert.deepStrictEqual(parsed.success.header, { alg: "RS256", typ: "JWT" });
			assert.deepStrictEqual(parsed.success.payload, { sub: "a-_b?>" });
			assert.deepStrictEqual(parsed.success.signature, new Uint8Array([1, 2, 3]));
			assert.deepStrictEqual(parsed.success.signingInput, new TextEncoder().encode(signingInput));
		}
	});

	it("decodes segments whose base64url form contains - and _", () => {
		// Values chosen so the encoded payload and signature carry the url-safe
		// characters; the asserts below prove they do, so the case cannot pass vacuously.
		const payload = { sub: "~~~???>>>" };
		const signature = new Uint8Array([0xfb, 0xff, 0xbf]);
		const { signingInput } = joinCompact({ alg: "ES256" }, payload);
		const token = appendSignature(signingInput, signature);
		const [, payloadSegment, signatureSegment] = token.split(".");
		assert.isTrue(/[-_]/.test(payloadSegment ?? ""), `payload segment ${payloadSegment} lacks - or _`);
		assert.isTrue(/[-_]/.test(signatureSegment ?? ""), `signature segment ${signatureSegment} lacks - or _`);
		const parsed = splitCompact(token);
		assert.isTrue(Result.isSuccess(parsed));
		if (Result.isSuccess(parsed)) {
			assert.deepStrictEqual(parsed.success.payload, payload);
			assert.deepStrictEqual(parsed.success.signature, signature);
		}
	});

	it("rejects two segments as malformed", () => {
		assert.strictEqual(reasonOf("a.b"), "malformed");
	});

	it("rejects four segments as malformed", () => {
		const parsed = splitCompact("a.b.c.d");
		assert.isTrue(Result.isFailure(parsed) && parsed.failure.reason === "malformed");
	});

	it("rejects a non-JSON header as malformed", () => {
		const token = `${Base64Url.encode("not json")}.${json({ sub: "x" })}.AQID`;
		assert.strictEqual(reasonOf(token), "malformed");
	});

	it("rejects an empty signature segment as malformed", () => {
		const token = `${json({ alg: "RS256" })}.${json({ sub: "x" })}.`;
		assert.strictEqual(reasonOf(token), "malformed");
	});

	it("rejects standard-base64 + or / in a segment as malformed", () => {
		const header = json({ alg: "RS256" });
		const payload = json({ sub: "x" });
		assert.strictEqual(reasonOf(`${header}.${payload}.+_8`), "malformed");
		assert.strictEqual(reasonOf(`${header}.${payload}.-/8`), "malformed");
		// control: the url-safe spelling of the same bytes parses
		assert.isUndefined(reasonOf(`${header}.${payload}.-_8`));
	});

	it("rejects padding and embedded newlines, which core Base64Url tolerates", () => {
		const header = json({ alg: "RS256" });
		const payload = json({ sub: "x" });
		assert.strictEqual(reasonOf(`${header}.${payload}.AQ==`), "malformed");
		assert.strictEqual(reasonOf(`${header}.${payload}.AQ\nID`), "malformed");
		assert.isUndefined(reasonOf(`${header}.${payload}.AQ`));
	});
});
