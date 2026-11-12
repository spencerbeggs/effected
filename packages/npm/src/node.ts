/**
 * The Node transport for `@effected/npm`: {@link NpmHttpClient}, an
 * `HttpClient` that applies an npm configuration's proxy and TLS settings,
 * and {@link NpmTransportError}, raised when one cannot be applied.
 *
 * The root entry never imports `@effect/platform-node`; this entry is the one
 * place the package reaches it (an optional peer), and only a consumer that
 * imports it pays for undici.
 *
 * @packageDocumentation
 */

export { NpmHttpClient, type NpmHttpClientOptions } from "./NpmHttpClient.js";
export { NpmTransportError } from "./NpmTransportError.js";
