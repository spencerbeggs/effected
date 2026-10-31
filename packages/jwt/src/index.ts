/**
 * JWS, JWT, JWK and JWKS sign and verify, safe for Cloudflare Workers: a thin
 * layer over core `effect/jose`, which does every signature, key import and
 * claim check. This package adds OIDC-discovery key resolution with a
 * pluggable cache (`JwksResolver`, `JwksStore`), PKCS#1 and one-line PEM
 * import, safe verification defaults, and `JwtError` routing keys. Signing and
 * verifying require core's `Signature` service.
 *
 * @packageDocumentation
 */

export { Jwk, Jwks } from "./Jwk.js";
export type { JwksResolverOptions, JwksResolverShape } from "./JwksResolver.js";
export { JwksResolver } from "./JwksResolver.js";
export type { CachedJwks, JwksStoreShape } from "./JwksStore.js";
export { JwksStore } from "./JwksStore.js";
export type { DecodedJws } from "./Jws.js";
export { JoseHeader, Jws } from "./Jws.js";
export type { VerifyOptions } from "./Jwt.js";
export { Jwt, RegisteredClaims } from "./Jwt.js";
export { JwtError, JwtErrorReason } from "./JwtError.js";
export type { JwtAlgorithm, SigningKey, VerificationKey } from "./JwtKey.js";
export { JwtKey } from "./JwtKey.js";
