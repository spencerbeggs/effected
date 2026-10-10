import { assert, describe, it } from "@effect/vitest";
import type { JwtError } from "@effected/jwt";
import { TestIssuer } from "@effected/jwt/testing";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { ActionsOidc, ActionsOidcClaims } from "../src/ActionsOidc.js";

const NOW_MILLIS = 1_800_000_000_000;

/** Run `use` against a fresh Actions-issuer double, with its resolver provided once around the whole test. */
const withActions = <A, E>(
	use: (actions: Effect.Success<ReturnType<typeof TestIssuer.make>>) => Effect.Effect<A, E, never>,
) =>
	Effect.gen(function* () {
		yield* TestClock.setTime(NOW_MILLIS);
		const actions = yield* TestIssuer.make({ issuer: ActionsOidc.issuer });
		return yield* use(actions);
	});

const reasonOf = (error: JwtError): string => error.reason;

describe("ActionsOidc.verify", () => {
	it.effect("verifies a runner token into typed, camelCase claims with numeric ids", () =>
		withActions((actions) =>
			Effect.gen(function* () {
				const token = yield* actions.sign(ActionsOidc.testClaims({ aud: "silk" }));
				const claims = yield* ActionsOidc.verify(token, { audience: "silk" }).pipe(
					Effect.provide(actions.resolverLayer),
				);
				assert.instanceOf(claims, ActionsOidcClaims);
				assert.strictEqual(claims.iss, ActionsOidc.issuer);
				assert.strictEqual(typeof claims.runId, "number");
				const wire = ActionsOidc.testClaims();
				assert.strictEqual(claims.runId, Number(wire.run_id));
				assert.strictEqual(claims.repositoryId, Number(wire.repository_id));
				assert.strictEqual(claims.repositoryOwnerId, Number(wire.repository_owner_id));
				assert.strictEqual(claims.runAttempt, Number(wire.run_attempt));
				assert.strictEqual(claims.actorId, Number(wire.actor_id));
				assert.strictEqual(claims.workflowRef, wire.workflow_ref);
				assert.strictEqual(claims.jobWorkflowRef, wire.job_workflow_ref);
				assert.strictEqual(claims.eventName, wire.event_name);
				assert.strictEqual(claims.runnerEnvironment, wire.runner_environment);
				assert.strictEqual(claims.repository, wire.repository);
			}),
		),
	);

	it.effect("refuses a token minted for another audience as wrongAudience", () =>
		withActions((actions) =>
			Effect.gen(function* () {
				const token = yield* actions.sign(ActionsOidc.testClaims({ aud: "someone-else" }));
				const error = yield* Effect.flip(
					ActionsOidc.verify(token, { audience: "silk" }).pipe(Effect.provide(actions.resolverLayer)),
				);
				assert.strictEqual(reasonOf(error), "wrongAudience");
			}),
		),
	);

	it.effect("refuses an empty audience before looking at the token", () =>
		withActions((actions) =>
			Effect.gen(function* () {
				// A token whose aud is the empty string: verifying against "" would accept it.
				const token = yield* actions.sign(ActionsOidc.testClaims({ aud: "" }));
				const error = yield* Effect.flip(
					ActionsOidc.verify(token, { audience: "" }).pipe(Effect.provide(actions.resolverLayer)),
				);
				assert.strictEqual(error._tag, "JwtError");
				assert.strictEqual(reasonOf(error), "wrongAudience");
			}),
		),
	);

	it.effect("refuses a token signed by the Actions key but naming another issuer as wrongIssuer", () =>
		withActions((actions) =>
			Effect.gen(function* () {
				const token = yield* actions.sign(ActionsOidc.testClaims({ aud: "silk", iss: "https://evil.example" }));
				const error = yield* Effect.flip(
					ActionsOidc.verify(token, { audience: "silk" }).pipe(Effect.provide(actions.resolverLayer)),
				);
				assert.strictEqual(reasonOf(error), "wrongIssuer");
			}),
		),
	);

	it.effect("refuses a token from a second issuer: unknownKid under its own kid, badSignature under a reused one", () =>
		withActions((actions) =>
			Effect.gen(function* () {
				// The key is always looked up for the Actions issuer, never for the token's
				// own iss, so a foreign issuer's key is never fetched or trusted.
				const ownKid = yield* TestIssuer.make({ issuer: "https://evil.example", kid: "evil-key" });
				const reusedKid = yield* TestIssuer.make({ issuer: "https://evil.example" });
				const reasons = yield* Effect.forEach([ownKid, reusedKid], (foreign) =>
					Effect.gen(function* () {
						const token = yield* foreign.sign(ActionsOidc.testClaims({ aud: "silk" }));
						return reasonOf(
							yield* Effect.flip(
								ActionsOidc.verify(token, { audience: "silk" }).pipe(Effect.provide(actions.resolverLayer)),
							),
						);
					}),
				);
				assert.deepStrictEqual(reasons, ["unknownKid", "badSignature"]);
			}),
		),
	);

	it.effect("refuses a payload missing workflow_ref as claims", () =>
		withActions((actions) =>
			Effect.gen(function* () {
				const { workflow_ref: _dropped, ...rest } = ActionsOidc.testClaims({ aud: "silk" });
				const token = yield* actions.sign(rest);
				const error = yield* Effect.flip(
					ActionsOidc.verify(token, { audience: "silk" }).pipe(Effect.provide(actions.resolverLayer)),
				);
				assert.strictEqual(reasonOf(error), "claims");
			}),
		),
	);

	it.effect("refuses a non-numeric id as claims", () =>
		withActions((actions) =>
			Effect.gen(function* () {
				for (const run_id of ["abc", "", "12.5", "1e3"]) {
					const token = yield* actions.sign(ActionsOidc.testClaims({ aud: "silk", run_id }));
					const error = yield* Effect.flip(
						ActionsOidc.verify(token, { audience: "silk" }).pipe(Effect.provide(actions.resolverLayer)),
					);
					assert.strictEqual(reasonOf(error), "claims", JSON.stringify(run_id));
				}
			}),
		),
	);

	it.effect("refuses an expired token as expired, after the tolerance", () =>
		withActions((actions) =>
			Effect.gen(function* () {
				const token = yield* actions.sign(ActionsOidc.testClaims({ aud: "silk" }));
				// TestIssuer stamps exp ten minutes out; the default tolerance is a minute.
				yield* TestClock.adjust(Duration.minutes(12));
				const error = yield* Effect.flip(
					ActionsOidc.verify(token, { audience: "silk" }).pipe(Effect.provide(actions.resolverLayer)),
				);
				assert.strictEqual(reasonOf(error), "expired");
				// A wide enough tolerance accepts it, so the option reaches Jwt.verify.
				const accepted = yield* ActionsOidc.verify(token, {
					audience: "silk",
					clockTolerance: Duration.minutes(5),
				}).pipe(Effect.provide(actions.resolverLayer));
				assert.instanceOf(accepted, ActionsOidcClaims);
			}),
		),
	);
});

describe("ActionsOidc.testClaims", () => {
	it("is wire-shaped: snake_case keys and string ids", () => {
		const claims = ActionsOidc.testClaims();
		assert.strictEqual(typeof claims.run_id, "string");
		assert.strictEqual(typeof claims.repository_id, "string");
		assert.isUndefined(claims.runId);
		assert.strictEqual(claims.iss, ActionsOidc.issuer);
	});

	it("applies overrides", () => {
		assert.strictEqual(ActionsOidc.testClaims({ ref: "refs/heads/dev" }).ref, "refs/heads/dev");
	});
});
