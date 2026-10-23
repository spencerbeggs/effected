import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { GitHub } from "../src/GitHub.js";
import { GITHUB_SECRET, NOON } from "./fixtures/generate-vectors.js";
import { bytes, hmac, request } from "./helpers.js";

const BODY = '{"action":"opened","number":1}';
const good = hmac(GITHUB_SECRET, [BODY], "hex");

const verify = (head: Record<string, string>, body: string = BODY) =>
	GitHub.verify(request(head, bytes(body), GITHUB_SECRET, NOON));
const reason = (head: Record<string, string>, body?: string) =>
	Effect.flip(verify(head, body)).pipe(Effect.map((error) => error.reason));

describe("GitHub.verify", () => {
	it.effect("accepts sha256=<hex> of the body", () =>
		Effect.gen(function* () {
			yield* verify({ "x-hub-signature-256": `sha256=${good}` });
		}),
	);

	describe("every part wrong in exactly one way is bad_signature", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			["the body, by one byte", `sha256=${hmac(GITHUB_SECRET, [BODY.replace("1", "2")], "hex")}`],
			["the key", `sha256=${hmac("not-the-secret", [BODY], "hex")}`],
			["the encoding: upper-case hex", `sha256=${good.toUpperCase()}`],
			["the prefix", `sha1=${good}`],
			["the length", `sha256=${good.slice(1)}`],
			["no prefix", good],
		];
		for (const [part, value] of cases) {
			it.effect(part, () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* reason({ "x-hub-signature-256": value }), "bad_signature");
				}),
			);
		}
	});

	it.effect("answers missing_signature without the header, and never reads the SHA-1 x-hub-signature", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* reason({}), "missing_signature");
			assert.strictEqual(yield* reason({ "x-hub-signature-256": "" }), "missing_signature");
			const sha1 = `sha1=${hmac(GITHUB_SECRET, [BODY], "hex")}`;
			assert.strictEqual(yield* reason({ "x-hub-signature": sha1 }), "missing_signature");
		}),
	);
});
