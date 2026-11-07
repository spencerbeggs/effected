import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it, layer } from "@effect/vitest";
import { Hmac } from "@effected/crypto";
import { Effect, Exit } from "effect";
import { vi } from "vitest";
import { AttestationContextError, SharedSecret } from "../src/SharedSecret.js";
import type { WebhookRequest } from "../src/WebhookRequest.js";
import { MacLive, bytes, hmac, request } from "./helpers.js";

const SECRET = "coolify-route-secret";
const BODY = '{"event":"deploy.finished"}';
const CONTEXT = ["coolify", "production"] as const;
const SECRET_HEADER = "x-intake-path-secret";
const ATTESTATION_HEADER = "x-intake-attestation";

/** The documented prefix for {@link CONTEXT}, spelled out by hand, never built by the code under test. */
const PREFIX = "effected-attestation.v1.2.coolify.production.";

/** An archived delivery: the attestation header only, never the secret. */
const archived = (attestation: string | undefined, body = BODY, secret = SECRET): WebhookRequest =>
	request(attestation === undefined ? {} : { [ATTESTATION_HEADER]: attestation }, bytes(body), secret, 0);

const attestedOptions = (context: ReadonlyArray<string> = CONTEXT) =>
	({ header: SECRET_HEADER, attestation: ATTESTATION_HEADER, context }) as const;

const verifyAttested = (delivery: WebhookRequest, context: ReadonlyArray<string> = CONTEXT) =>
	SharedSecret.verifyAttested(delivery, attestedOptions(context));

/** The failure's routing key: a verification reason, or the context error's tag. */
const failureOf = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
	Effect.flip(effect).pipe(
		Effect.map((error) =>
			error instanceof AttestationContextError
				? error._tag
				: (error as { readonly reason?: string; readonly _tag?: string }).reason,
		),
	);

/** The attestation of `body` under the route secret, computed by the code under test. */
const attestOf = (body = BODY, context: ReadonlyArray<string> = CONTEXT, secret = SECRET) =>
	SharedSecret.attest(request({}, bytes(body), secret, 0), { context });

layer(MacLive)("SharedSecret.attest", (it) => {
	it.effect("is the lower-case hex HMAC-SHA256 of the documented prefix then the raw body", () =>
		Effect.gen(function* () {
			const attestation = yield* attestOf();
			// node:crypto, never the code under test, over the prefix spelled out by hand.
			assert.strictEqual(attestation, hmac(SECRET, [PREFIX, BODY], "hex"));
			assert.match(attestation, /^[0-9a-f]{64}$/);
			assert.strictEqual(SharedSecret.ATTESTATION_TAG, "effected-attestation.v1");
		}),
	);

	it.effect("counts the context parts, so an empty context still has a prefix", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* attestOf(BODY, []), hmac(SECRET, ["effected-attestation.v1.0.", BODY], "hex"));
			assert.strictEqual(
				yield* attestOf(BODY, ["a", "b", "c"]),
				hmac(SECRET, ["effected-attestation.v1.3.a.b.c.", BODY], "hex"),
			);
		}),
	);

	it.effect("is never a vendor HMAC of the body alone under the same secret", () =>
		Effect.gen(function* () {
			const attestation = yield* attestOf();
			assert.notStrictEqual(attestation, hmac(SECRET, [BODY], "hex"));
		}),
	);

	it.effect("fails with AttestationContextError for an empty part or one containing the separator", () =>
		Effect.gen(function* () {
			const empty = yield* Effect.flip(attestOf(BODY, ["coolify", ""]));
			assert.instanceOf(empty, AttestationContextError);
			assert.strictEqual(empty.reason, "empty");
			assert.strictEqual(empty.index, 1);
			assert.deepStrictEqual(empty.context, ["coolify", ""]);
			const dotted = yield* Effect.flip(attestOf(BODY, ["a.b", "c"]));
			assert.strictEqual(dotted.reason, "contains_separator");
			assert.strictEqual(dotted.index, 0);
			assert.include(dotted.message, "index 0");
			// The control: the same parts without the dot attest.
			yield* attestOf(BODY, ["ab", "c"]);
		}),
	);

	it.effect("dies, rather than failing, on an empty route secret", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(attestOf(BODY, CONTEXT, ""));
			assert.isTrue(Exit.hasDies(exit));
		}),
	);
});

layer(MacLive)("SharedSecret.verifyAttested", (it) => {
	it.effect("round-trips: an archived delivery verifies by the attestation minted for it", () =>
		Effect.gen(function* () {
			const attestation = yield* attestOf();
			yield* verifyAttested(archived(attestation));
			// Hex is decoded and compared as bytes, so either case verifies.
			yield* verifyAttested(archived(attestation.toUpperCase()));
		}),
	);

	it.effect("answers bad_signature for a wrong context: another value, another order, another length", () =>
		Effect.gen(function* () {
			const attestation = yield* attestOf();
			for (const context of [["coolify", "staging"], ["production", "coolify"], ["coolify"], [...CONTEXT, "x"], []]) {
				assert.strictEqual(
					yield* failureOf(verifyAttested(archived(attestation), context)),
					"bad_signature",
					context.join("|"),
				);
			}
			// The control: the original context still verifies.
			yield* verifyAttested(archived(attestation));
		}),
	);

	it.effect("binds the context to its length: a part cannot move across the body boundary", () =>
		Effect.gen(function* () {
			// Without the count, ["coolify"] over "production.<body>" and ["coolify", "production"] over "<body>" would
			// be the same bytes.
			assert.strictEqual(
				hmac(SECRET, ["effected-attestation.v1.coolify.", `production.${BODY}`], "hex"),
				hmac(SECRET, ["effected-attestation.v1.coolify.production.", BODY], "hex"),
			);
			const shifted = yield* attestOf(`production.${BODY}`, ["coolify"]);
			assert.strictEqual(yield* failureOf(verifyAttested(archived(shifted))), "bad_signature");
		}),
	);

	it.effect("answers bad_signature for a tampered body, a wrong secret or an attestation that does not decode", () =>
		Effect.gen(function* () {
			const attestation = yield* attestOf();
			assert.strictEqual(yield* failureOf(verifyAttested(archived(attestation, `${BODY} `))), "bad_signature");
			assert.strictEqual(yield* failureOf(verifyAttested(archived(attestation, BODY.slice(1)))), "bad_signature");
			assert.strictEqual(yield* failureOf(verifyAttested(archived(attestation, BODY, `${SECRET}x`))), "bad_signature");
			for (const value of ["not-hex", attestation.slice(0, -2), `${attestation}00`, "zz".repeat(32)]) {
				assert.strictEqual(yield* failureOf(verifyAttested(archived(value))), "bad_signature", value);
			}
		}),
	);

	it.effect("answers missing_signature with neither the secret header nor an attestation", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* failureOf(verifyAttested(archived(undefined))), "missing_signature");
			assert.strictEqual(yield* failureOf(verifyAttested(archived(""))), "missing_signature");
			assert.strictEqual(yield* failureOf(verifyAttested(archived("   "))), "missing_signature");
			const error = yield* Effect.flip(verifyAttested(archived(undefined)));
			assert.strictEqual(error._tag, "WebhookVerificationError");
			assert.isTrue(error._tag === "WebhookVerificationError" && error.preset === "SharedSecret");
		}),
	);

	it.effect("checks the live secret first when header is given, and the live header decides", () =>
		Effect.gen(function* () {
			const attestation = yield* attestOf();
			const live = (value: string, withAttestation: string | undefined) =>
				request(
					{
						[SECRET_HEADER]: value,
						...(withAttestation === undefined ? {} : { [ATTESTATION_HEADER]: withAttestation }),
					},
					bytes(BODY),
					SECRET,
					0,
				);
			// The live secret verifies with no attestation, and with a garbage one.
			yield* verifyAttested(live(SECRET, undefined));
			yield* verifyAttested(live(SECRET, "garbage"));
			// A wrong live secret is final: a valid attestation beside it does not rescue it.
			assert.strictEqual(yield* failureOf(verifyAttested(live("wrong", attestation))), "bad_signature");
			// Compared raw, as SharedSecret.verify compares it: whitespace is a wrong secret, not an absent one.
			assert.strictEqual(yield* failureOf(verifyAttested(live(` ${SECRET}`, attestation))), "bad_signature");
			assert.strictEqual(yield* failureOf(verifyAttested(live("   ", attestation))), "bad_signature");
			// An empty live header is absent, so the attestation decides.
			yield* verifyAttested(live("", attestation));
		}),
	);

	it.effect("without header, never reads the secret header: the attestation alone decides", () =>
		Effect.gen(function* () {
			const delivery = request({ [SECRET_HEADER]: SECRET }, bytes(BODY), SECRET, 0);
			const error = yield* Effect.flip(
				SharedSecret.verifyAttested(delivery, { attestation: ATTESTATION_HEADER, context: CONTEXT }),
			);
			assert.isTrue(error._tag === "WebhookVerificationError" && error.reason === "missing_signature");
			const attestation = yield* attestOf();
			yield* SharedSecret.verifyAttested(
				request({ [SECRET_HEADER]: "wrong", [ATTESTATION_HEADER]: attestation }, bytes(BODY), SECRET, 0),
				{ attestation: ATTESTATION_HEADER, context: CONTEXT },
			);
		}),
	);

	it.effect("validates the context before anything else, even beside a correct live secret", () =>
		Effect.gen(function* () {
			const delivery = request({ [SECRET_HEADER]: SECRET }, bytes(BODY), SECRET, 0);
			assert.strictEqual(yield* failureOf(verifyAttested(delivery, ["coolify", "prod.eu"])), "AttestationContextError");
			assert.strictEqual(yield* failureOf(verifyAttested(delivery, [""])), "AttestationContextError");
		}),
	);

	it.effect("checks the attestation with @effected/crypto's Hmac.verify, and only on the attestation step", () =>
		Effect.gen(function* () {
			const attestation = yield* attestOf();
			const calls = yield* Effect.acquireUseRelease(
				Effect.sync(() => vi.spyOn(Hmac, "verify")),
				(spy) =>
					Effect.gen(function* () {
						yield* verifyAttested(archived(attestation));
						const afterAttestation = spy.mock.calls.length;
						yield* verifyAttested(request({ [SECRET_HEADER]: SECRET }, bytes(BODY), SECRET, 0));
						return { afterAttestation, afterLive: spy.mock.calls.length, input: spy.mock.calls[0]?.[0] };
					}),
				(spy) => Effect.sync(() => spy.mockRestore()),
			);
			assert.strictEqual(calls.afterAttestation, 1);
			// The live-secret path compares with ConstantTime.secretsEqual instead; no Hmac.verify.
			assert.strictEqual(calls.afterLive, 1);
			assert.isTrue(calls.input !== undefined && "encoding" in calls.input && calls.input.encoding === "hex");
			assert.strictEqual(calls.input?.algorithm, "SHA-256");
		}),
	);
});

/** A source text with comments removed: line comments first, then block comments. */
const code = (source: string): string => source.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("SharedSecret source", () => {
	const source = code(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/SharedSecret.ts"), "utf8"));
	const attestedBody = source.slice(source.indexOf('Effect.fn("SharedSecret.verifyAttested")'));

	it("the comment stripper keeps code and drops comments", () => {
		assert.strictEqual(code("// Hmac.verify(\nconst a = 1; /* Hmac.verify( */"), "\nconst a = 1; ");
	});

	it("verifyAttested compares through Hmac.verify, never a hand-rolled string comparison", () => {
		// positive control: the slice found the function
		assert.isTrue(attestedBody.length > 0 && source.includes('Effect.fn("SharedSecret.verifyAttested")'));
		assert.include(attestedBody, "Hmac.verify(");
		assert.notInclude(attestedBody, "ConstantTime.equal(");
	});
});
