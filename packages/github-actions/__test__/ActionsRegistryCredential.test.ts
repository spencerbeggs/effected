import { assert, describe, it } from "@effect/vitest";
import { ActionsOidcClaims } from "@effected/github";
import { Effect, Layer, Redacted } from "effect";
import { ActionOutputs, ActionsRegistryCredential, OidcTokenError, OidcTokenIssuer } from "../src/index.js";

const CLAIMS = ActionsOidcClaims.make({
	iss: "https://token.actions.githubusercontent.com",
	sub: "repo:acme/example:ref:refs/heads/main",
	aud: "https://registry.example",
	exp: 1_800_000_600,
	iat: 1_800_000_000,
	ref: "refs/heads/main",
	sha: "0000000000000000000000000000000000000000",
	repository: "acme/example",
	eventName: "push",
	jobWorkflowRef: "acme/example/.github/workflows/release.yml@refs/heads/main",
	workflowRef: "acme/example/.github/workflows/release.yml@refs/heads/main",
	repositoryId: 1,
	repositoryOwner: "acme",
	repositoryOwnerId: 2,
	runnerEnvironment: "github-hosted",
	runId: 3,
	runAttempt: 1,
	actor: "octocat",
	actorId: 583231,
});

/** The token the recording issuer answers with, read the way a test may: here, not in `src`. */
const ISSUED = Redacted.value(OidcTokenIssuer.unsignedTokenFor(CLAIMS));

describe("OidcTokenIssuer.recording", () => {
	it.effect("answers like layerFor and records every audience asked for, in order", () =>
		Effect.gen(function* () {
			const recorder = OidcTokenIssuer.recording(CLAIMS);
			const answered = yield* Effect.gen(function* () {
				const issuer = yield* OidcTokenIssuer;
				const token = yield* issuer.token("https://registry.example");
				const claims = yield* issuer.claims();
				return { token, claims };
			}).pipe(Effect.provide(recorder.layer));
			assert.strictEqual(Redacted.value(answered.token), ISSUED);
			assert.strictEqual(answered.claims, CLAIMS);
			assert.deepStrictEqual(recorder.audiences(), ["https://registry.example", undefined]);
		}),
	);

	it("each call keeps its own journal", () => {
		const first = OidcTokenIssuer.recording(CLAIMS);
		const second = OidcTokenIssuer.recording(CLAIMS);
		assert.notStrictEqual(first.layer, second.layer);
		assert.deepStrictEqual(second.audiences(), []);
	});
});

describe("ActionsRegistryCredential.workload", () => {
	const options = { audience: "https://registry.example", prefix: "pnpr_workload_" } as const;

	it.effect(
		"mints for the audience verbatim, masks the bare token and then the prefixed value, and returns them redacted",
		() =>
			Effect.gen(function* () {
				const issuer = OidcTokenIssuer.recording(CLAIMS);
				const outputs = ActionOutputs.recording();
				const credential = yield* ActionsRegistryCredential.workload(options).pipe(
					Effect.provide(Layer.mergeAll(issuer.layer, outputs.layer)),
				);
				assert.deepStrictEqual(issuer.audiences(), ["https://registry.example"]);
				assert.deepStrictEqual(
					outputs.entries().map((entry) => [entry.member, entry.value]),
					[
						["setSecret", ISSUED],
						["setSecret", `pnpr_workload_${ISSUED}`],
					],
				);
				assert.strictEqual(credential.kind, "workload");
				assert.strictEqual(credential.audience, "https://registry.example");
				assert.strictEqual(Redacted.value(credential.token), `pnpr_workload_${ISSUED}`);
				assert.notInclude(String(credential.token), ISSUED);
				assert.notInclude(JSON.stringify(credential), ISSUED);
			}),
	);

	it.effect("an issuer failure stays an OidcTokenError, and nothing is masked or built", () =>
		Effect.gen(function* () {
			const outputs = ActionOutputs.recording();
			const issuer = OidcTokenIssuer.layerTest({
				token: () => Effect.fail(new OidcTokenError({ reason: "unavailable", detail: "ACTIONS_ID_TOKEN_REQUEST_URL" })),
			});
			const error = yield* Effect.flip(
				ActionsRegistryCredential.workload(options).pipe(Effect.provide(Layer.mergeAll(issuer, outputs.layer))),
			);
			assert.instanceOf(error, OidcTokenError);
			assert.strictEqual(error.reason, "unavailable");
			assert.lengthOf(outputs.entries(), 0);
		}),
	);
});
