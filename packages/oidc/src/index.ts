/**
 * OpenID Connect for Effect v4: the `IdentityToken` issuer contract, ID-token
 * claims, and an unverified decode and a discovery-backed verify over
 * `@effected/jwt`.
 *
 * @packageDocumentation
 */

export type { IdentityTokenShape } from "./IdentityToken.js";
export { IdentityToken, IdentityTokenError } from "./IdentityToken.js";
export { IdTokenClaims } from "./IdTokenClaims.js";
export type { OidcVerifyOptions } from "./Oidc.js";
export { Oidc } from "./Oidc.js";
