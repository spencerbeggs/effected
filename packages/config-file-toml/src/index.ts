/**
 * A `ConfigCodec` adapter plugging `@effected/toml` into
 * `@effected/config-file`'s codec seam: TOML as configuration file content.
 *
 * @example
 * ```ts
 * import { TomlCodec } from "@effected/config-file-toml";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const value = yield* TomlCodec.parse('port = 3000\nhost = "localhost"\n');
 *   return value; // { port: 3000, host: "localhost" }
 * });
 * ```
 *
 * @see {@link https://effect.website | Effect}
 *
 * @packageDocumentation
 */

export { TomlCodec } from "./TomlCodec.js";
