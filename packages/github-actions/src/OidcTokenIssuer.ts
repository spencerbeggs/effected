import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { HttpClient } from "effect/unstable/http";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { ActionEnvironment } from "./ActionEnvironment.js";

/**
 * Raised when an OIDC token cannot be issued or read.
 *
 * @public
 */
export class OidcTokenError extends Schema.TaggedErrorClass<OidcTokenError>()("OidcTokenError", {
	/**
	 * `unavailable` — the runner did not publish the token-service variables,
	 * which almost always means the workflow is missing `permissions: id-token:
	 * write`. `requestFailed` — the token service could not be reached or refused
	 * the request. `malformedResponse` — it answered with something that is not a
	 * token envelope. `malformedToken` — the token is not a decodable JWT.
	 * `missingClaims` — it decoded, but without the claims a provenance statement
	 * needs.
	 */
	reason: Schema.Literals(["unavailable", "requestFailed", "malformedResponse", "malformedToken", "missingClaims"]),
	/** What was wrong, in one line. */
	detail: Schema.optionalKey(Schema.String),
	/** The HTTP status, when the token service answered. */
	status: Schema.optionalKey(Schema.Number),
	/** The underlying failure, preserved structurally. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		switch (this.reason) {
			case "unavailable":
				return "The runner published no OIDC token service; the workflow needs `permissions: id-token: write`";
			case "requestFailed":
				return `The OIDC token request failed${this.status === undefined ? "" : ` with status ${this.status}`}`;
			case "malformedResponse":
				return "The OIDC token service answered with an unexpected shape";
			case "malformedToken":
				return `The OIDC token is not a decodable JWT${this.detail === undefined ? "" : `: ${this.detail}`}`;
			default:
				return "The OIDC token is missing claims a provenance statement needs";
		}
	}
}

/**
 * The claims a GitHub Actions OIDC token carries about the workflow that ran.
 *
 * @remarks
 * The field names are GitHub's own JWT claim names, kept verbatim rather than
 * translated to the kit's casing. They are an **external vocabulary** — the
 * same strings that appear in a SLSA provenance predicate and in every
 * published example of an Actions OIDC policy — and renaming them would put a
 * translation layer between a consumer and the specification they are reading.
 *
 * @public
 */
export class OidcClaims extends Schema.Class<OidcClaims>("OidcClaims")({
	/** The issuer, e.g. `https://token.actions.githubusercontent.com`. */
	iss: Schema.String,
	/** The full ref the workflow ran on. */
	ref: Schema.String,
	/** The commit. */
	sha: Schema.String,
	/** `owner/repo`. */
	repository: Schema.String,
	/** The event that triggered the run. */
	event_name: Schema.String,
	/** The reusable-workflow ref, which is what a verifier pins against. */
	job_workflow_ref: Schema.String,
	/** The calling workflow's ref. */
	workflow_ref: Schema.String,
	/** The numeric repository id, as a string. */
	repository_id: Schema.String,
	/** The numeric owner id, as a string. */
	repository_owner_id: Schema.String,
	/** `github-hosted` or `self-hosted`. */
	runner_environment: Schema.String,
	/** The run id, as a string. */
	run_id: Schema.String,
	/** The run attempt, as a string. */
	run_attempt: Schema.String,
}) {}

/** The token envelope the runner's token service answers with. */
const TokenEnvelope = Schema.Struct({
	value: Schema.String,
	count: Schema.optionalKey(Schema.Number),
});

const REQUEST_TOKEN = "ACTIONS_ID_TOKEN_REQUEST_TOKEN";
const REQUEST_URL = "ACTIONS_ID_TOKEN_REQUEST_URL";

/**
 * Decode a JWT payload segment.
 *
 * @remarks
 * `base64url` states the intent, though it is not what makes this work: Node's
 * plain `base64` decoder happens to accept the url alphabet and unpadded input
 * too (probed at beta.101), so the two are interchangeable *here*. They are not
 * interchangeable everywhere — `atob` is not forgiving — which is why the
 * declaration is the strict one and there is a test whose payload actually
 * contains `-` and `_`.
 */
const decodeSegment = (segment: string): unknown => JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));

/**
 * Read the claims out of a JWT **without verifying its signature**.
 *
 * @remarks
 * The absence of verification is deliberate and is documented on
 * {@link OidcTokenIssuerShape.claims}; do not "fix" it here.
 */
const readClaims = (token: string): Effect.Effect<OidcClaims, OidcTokenError> =>
	Effect.gen(function* () {
		const parts = token.split(".");
		const payload = parts[1];
		if (parts.length !== 3 || payload === undefined || payload === "") {
			return yield* Effect.fail(
				new OidcTokenError({ reason: "malformedToken", detail: `expected three segments, got ${parts.length}` }),
			);
		}
		const decoded = yield* Effect.try({
			try: () => decodeSegment(payload),
			catch: (cause) =>
				new OidcTokenError({ reason: "malformedToken", detail: "the payload is not base64url JSON", cause }),
		});
		return yield* Schema.decodeUnknownEffect(OidcClaims)(decoded).pipe(
			Effect.mapError((cause) => new OidcTokenError({ reason: "missingClaims", cause })),
		);
	});

/**
 * The {@link OidcTokenIssuer} service shape.
 *
 * @public
 */
export interface OidcTokenIssuerShape {
	/**
	 * Request an ID token, optionally bound to an audience.
	 *
	 * @remarks
	 * Omitting the audience sends no `audience` parameter at all, matching
	 * `@actions/core.getIDToken` — the runner's default audience is not the empty
	 * string.
	 */
	readonly token: (audience?: string) => Effect.Effect<Redacted.Redacted<string>, OidcTokenError>;
	/**
	 * The token's claims, decoded.
	 *
	 * @remarks
	 * **The signature is deliberately not verified**, for three reasons that are
	 * recorded so nobody "fixes" it:
	 *
	 * 1. The token comes from the runner's own token-service endpoint over TLS.
	 *    The transport is the trust boundary, and the process asking for the
	 *    token is the process that received it.
	 * 2. The claims populate a provenance predicate, not a trust decision.
	 *    Nothing branches on them for authorization; they are recorded as
	 *    attested facts about the workflow that ran.
	 * 3. Verifying would need a JWKS fetch, which turns a decode into a network
	 *    call — untestable without a fixture server, and dependent on GitHub's
	 *    key endpoint being reachable at attestation time.
	 *
	 * A consumer that needs a *verified* token needs a different operation with a
	 * different name and a different error channel, not an option on this one.
	 *
	 * Claims are on the surface rather than left to the call site because that is
	 * what makes the provenance path reachable in a test: a double built with
	 * {@link OidcTokenIssuer.layerFor} answers with real, decodable claims, where
	 * the synthetic non-JWT its predecessor returned made every consumer's
	 * `decodeJwtClaims` yield nothing and silently skipped the path under test.
	 */
	readonly claims: (audience?: string) => Effect.Effect<OidcClaims, OidcTokenError>;
}

const make = Effect.gen(function* () {
	const env = yield* ActionEnvironment;
	const http = yield* HttpClient.HttpClient;

	const required = (name: string): Effect.Effect<string, OidcTokenError> =>
		env.get(name).pipe(Effect.mapError(() => new OidcTokenError({ reason: "unavailable", detail: name })));

	/**
	 * The raw JWT, before it is wrapped.
	 *
	 * @remarks
	 * `claims` reads this rather than unwrapping what `token` returns, so
	 * `Redacted.value` does not appear in this module at all — the package's
	 * declassification invariant is that `Secret.ts` is the only place a secret
	 * becomes a string, and a wrap-then-immediately-unwrap here would be a
	 * genuine exception to it rather than a cosmetic one. A structural test over
	 * `src/` enforces this, and it caught exactly this call when the first draft
	 * did it the obvious way.
	 */
	const issue = Effect.fn("OidcTokenIssuer.token")(function* (audience?: string) {
		const bearer = yield* required(REQUEST_TOKEN);
		const base = yield* required(REQUEST_URL);
		// The runner's URL already carries a query string, so the audience is
		// appended with `&` rather than `?`.
		const url = audience === undefined ? base : `${base}&audience=${encodeURIComponent(audience)}`;

		const response = yield* http
			.get(url, { headers: { authorization: `Bearer ${bearer}`, accept: "application/json" } })
			.pipe(Effect.mapError((cause) => new OidcTokenError({ reason: "requestFailed", cause })));

		if (response.status < 200 || response.status >= 300) {
			return yield* Effect.fail(new OidcTokenError({ reason: "requestFailed", status: response.status }));
		}

		const envelope = yield* HttpClientResponse.schemaBodyJson(TokenEnvelope)(response).pipe(
			Effect.mapError((cause) => new OidcTokenError({ reason: "malformedResponse", cause })),
		);
		return envelope.value;
	});

	return {
		token: (audience?: string) => Effect.map(issue(audience), Redacted.make),
		claims: Effect.fn("OidcTokenIssuer.claims")(function* (audience?: string) {
			return yield* readClaims(yield* issue(audience));
		}),
	} satisfies OidcTokenIssuerShape;
});

const unimplemented = (member: string): never => {
	throw new Error(`OidcTokenIssuer.makeTest: ${member}() was called but not stubbed — pass a \`${member}\` override.`);
};

/**
 * The runner's OIDC token service.
 *
 * @remarks
 * Lives here rather than with attestation because it reads
 * `ACTIONS_ID_TOKEN_REQUEST_TOKEN` and `ACTIONS_ID_TOKEN_REQUEST_URL`, which
 * exist only when a workflow declares `permissions: id-token: write` — that is
 * a fact about the runner, not about signing.
 *
 * @example
 * ```ts
 * import { OidcTokenIssuer } from "@effected/github-actions";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const issuer = yield* OidcTokenIssuer;
 *   const claims = yield* issuer.claims("sigstore");
 *   return claims.job_workflow_ref;
 * });
 * ```
 *
 * @public
 */
export class OidcTokenIssuer extends Context.Service<OidcTokenIssuer, OidcTokenIssuerShape>()(
	"@effected/github-actions/OidcTokenIssuer",
) {
	static readonly layer: Layer.Layer<OidcTokenIssuer, never, ActionEnvironment | HttpClient.HttpClient> = Layer.effect(
		this,
		make,
	);

	/**
	 * An **unsigned** JWT carrying these claims.
	 *
	 * @remarks
	 * For building test doubles, and nothing else: the signature segment is a
	 * placeholder, so this token would fail any verifier. It exists because the
	 * alternative — a double returning a synthetic non-JWT — is what made the
	 * provenance path structurally unreachable in the source package, drawing
	 * four separate apologetic comments from one consumer.
	 */
	static readonly unsignedTokenFor = (claims: OidcClaims): Redacted.Redacted<string> => {
		const segment = (value: unknown): string => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
		return Redacted.make(
			`${segment({ alg: "RS256", typ: "JWT" })}.${segment(Schema.encodeUnknownSync(OidcClaims)(claims))}.unsigned`,
		);
	};

	/** A test double. Unstubbed members die rather than answering with a non-token. */
	static readonly makeTest = (overrides: Partial<OidcTokenIssuerShape> = {}): OidcTokenIssuerShape => ({
		token: () => Effect.sync(() => unimplemented("token")),
		claims: () => Effect.sync(() => unimplemented("claims")),
		...overrides,
	});

	/** {@link OidcTokenIssuer.makeTest} behind `Layer.succeed`. */
	static readonly layerTest = (overrides: Partial<OidcTokenIssuerShape> = {}): Layer.Layer<OidcTokenIssuer> =>
		Layer.succeed(OidcTokenIssuer, OidcTokenIssuer.makeTest(overrides));

	/**
	 * A double that answers with these claims, consistently on both members.
	 *
	 * @remarks
	 * `token()` returns a real decodable JWT built from the same claims
	 * `claims()` returns, so a consumer that decodes the token itself and a
	 * consumer that asks the service both see the same thing. A double whose two
	 * members can disagree is how a test proves a path works while production
	 * takes the other one.
	 */
	static readonly layerFor = (claims: OidcClaims): Layer.Layer<OidcTokenIssuer> =>
		Layer.succeed(OidcTokenIssuer, {
			token: () => Effect.succeed(OidcTokenIssuer.unsignedTokenFor(claims)),
			claims: () => Effect.succeed(claims),
		});
}
