// The seam between core `effect/jose` and this package's `JwtError`.
//
// Every signature, key import, segment codec and registered-claim check runs
// in core. What lives here is the translation: core's `JoseError` reasons onto
// the routing keys `JwtError` has always carried, and the shim that lets a
// caller's key, or a function from the header to one, stand in for core's
// `Jwks` service so `verifyWithKeySet` does the parsing, the algorithm
// allowlist and the signature check.

import type { Duration } from "effect";
import { Effect, Schema } from "effect";
import type { Jws as CoreJws } from "effect/jose";
import { Jwk as CoreJwk, Jwks as CoreJwks, JoseError } from "effect/jose";
import type { Jwk } from "../Jwk.js";
import { JwtError } from "../JwtError.js";
import type { VerificationKey } from "../JwtKey.js";
import { finiteMillis } from "./duration.js";
import { capped, kidLimit } from "./quote.js";

/**
 * Every asymmetric JWS algorithm core implements. HMAC is excluded: a token
 * verified against a published key set must never select a shared secret.
 *
 * @internal
 */
export const asymmetricAlgorithms: ReadonlyArray<CoreJwk.AsymmetricAlgorithm> = CoreJwk.AsymmetricAlgorithm.literals;

/** @internal */
export const isAsymmetricAlgorithm: (alg: string) => alg is CoreJwk.AsymmetricAlgorithm = Schema.is(
	CoreJwk.AsymmetricAlgorithm,
) as (alg: string) => alg is CoreJwk.AsymmetricAlgorithm;

/** @internal */
export const unsupportedAlgorithm = (detail: string, kid?: string): JwtError =>
	JwtError.of("unsupportedAlgorithm", detail, kid === undefined ? undefined : { kid });

/** The `kid` extra for a `JwtError`, capped: a header's `kid` is attacker-chosen. @internal */
export const kidOf = (kid: string | undefined): { readonly kid: string } | undefined =>
	kid === undefined ? undefined : { kid: capped(kid, kidLimit) };

const claimReason = (reason: JoseError.ClaimValidationFailed): JwtError["reason"] => {
	switch (reason.claim) {
		case "exp":
			return reason.reason === "expired" ? "expired" : "claims";
		case "nbf":
			return reason.reason === "notYetValid" ? "notYetValid" : "claims";
		case "iat":
			return reason.reason === "future" ? "notYetValid" : "claims";
		case "iss":
			return "wrongIssuer";
		case "aud":
			return "wrongAudience";
		default:
			return "claims";
	}
};

/**
 * What a verification knew when core failed: the key it resolved, if any,
 * and the header it was resolved for. Decides between `unsupportedAlgorithm`
 * (no key was ever asked for) and `algorithmMismatch` (one was).
 *
 * @internal
 */
export interface VerifyState {
	resolved: VerificationKey | undefined;
	kid: string | undefined;
	resolverFailure: JwtError | undefined;
}

/**
 * A core `JoseError` (or a claims `SchemaError`) as a `JwtError`.
 *
 * @internal
 */
export const toJwtError = (error: JoseError.JoseError | Schema.SchemaError, state?: VerifyState): JwtError => {
	if (state?.resolverFailure !== undefined) return state.resolverFailure;
	const extra = kidOf(state?.resolved?.kid ?? state?.kid);
	if (Schema.isSchemaError(error)) {
		return JwtError.of("claims", "the payload does not match the expected claims", { ...extra, cause: error });
	}
	const reason = error.reason;
	switch (reason._tag) {
		case "InvalidToken":
			return JwtError.of("malformed", reason.description, { ...extra, cause: error });
		case "AlgorithmNotAllowed":
			return state?.resolved === undefined
				? unsupportedAlgorithm(
						"the token claims an algorithm outside RS256-512, PS256-512, ES256-512 and EdDSA",
						extra?.kid,
					)
				: JwtError.of(
						"algorithmMismatch",
						`the token's alg is not the key's algorithm, ${state.resolved.algorithm}`,
						extra,
					);
		case "SignatureVerificationFailed":
			return JwtError.of("badSignature", "the signature does not verify", extra);
		case "InvalidKey":
			return JwtError.of("key", reason.description, { ...extra, cause: error });
		case "KeyNotFound":
		case "AmbiguousKey":
			return JwtError.of("unknownKid", reason.message, extra);
		case "KeySetUnavailable":
			return JwtError.of("jwksFetch", reason.description, { ...extra, cause: error });
		case "ClaimValidationFailed":
			return JwtError.of(claimReason(reason), reason.message, { ...extra, cause: error });
		case "InvalidArgument":
			return JwtError.of("claims", reason.description, { ...extra, cause: error });
		case "DecryptionFailed":
			return JwtError.of("malformed", reason.message, extra);
	}
};

const keyNotFound = new JoseError.JoseError({ reason: new JoseError.KeyNotFound() });

/**
 * A core `Jwks` service answering every selection with `key`, or with what
 * `key` resolves the header to. A resolver's own `JwtError` is kept on
 * `state` and surfaces unchanged; core only sees `KeyNotFound`.
 *
 * @internal
 */
export const keySetFor = <R>(
	key: VerificationKey | ((header: CoreJws.ProtectedHeader) => Effect.Effect<VerificationKey, JwtError, R>),
	state: VerifyState,
): Effect.Effect<CoreJwks.Jwks["Service"], never, R> =>
	Effect.map(Effect.context<R>(), (context) =>
		CoreJwks.Jwks.of({
			resolve: (selection) => {
				state.kid = selection.kid;
				const header = selection.protectedHeader ?? {
					alg: selection.algorithm,
					...(selection.kid !== undefined ? { kid: selection.kid } : {}),
				};
				// `typeof`, not `instanceof`: a key built by a second copy of this
				// package (a duplicated dependency) is still a key, not a function.
				const lookup = typeof key === "function" ? key(header) : Effect.succeed(key);
				return lookup.pipe(
					Effect.provideContext(context),
					Effect.tap((resolved) =>
						Effect.sync(() => {
							state.resolved = resolved;
						}),
					),
					Effect.catch((failure: JwtError) =>
						Effect.andThen(
							Effect.sync(() => {
								state.resolverFailure = failure;
							}),
							Effect.fail(keyNotFound),
						),
					),
				);
			},
		}),
	);

/** A fresh, empty {@link VerifyState}. @internal */
export const makeState = (): VerifyState => ({ resolved: undefined, kid: undefined, resolverFailure: undefined });

/**
 * The tolerance in seconds, for the checks core does not run itself; `0` when
 * the input is unreadable, which core has already refused by then.
 *
 * @internal
 */
export const toleranceSeconds = (input: Duration.Input): number => (finiteMillis(input) ?? 0) / 1000;

const publicMembers = ["kty", "crv", "n", "e", "x", "y", "kid", "alg", "use", "key_ops"] as const;

/**
 * The public members of a {@link Jwk}, the only ones core's importer is given:
 * private members are `Redacted` in `Jwk` and are never unwrapped, and core
 * refuses a public import that carries any.
 *
 * @internal
 */
export const toPublicJwk = (jwk: Jwk): CoreJwk.PublicJwk => {
	const out: Record<string, unknown> = {};
	for (const name of publicMembers) if (jwk[name] !== undefined) out[name] = jwk[name];
	return out as CoreJwk.PublicJwk;
};

const isCorePublicJwk = Schema.is(CoreJwk.PublicJwk);

/**
 * The keys of a decoded set that core can select and import, as core's key set.
 *
 * @internal
 */
export const toCoreKeySet = (keys: ReadonlyArray<Jwk>): CoreJwks.KeySet => ({
	keys: keys.map(toPublicJwk).filter(isCorePublicJwk),
});
