/**
 * A `ConfigCodec` adapter plugging `@effected/jsonc` into
 * `@effected/config-file`'s codec seam: JSON with comments and trailing
 * commas as configuration file content.
 *
 * @example
 * ```ts
 * import { JsoncCodec } from "@effected/config-file-jsonc";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const value = yield* JsoncCodec.parse('{ "port": 3000 // dev\n }');
 *   return value; // { port: 3000 }
 * });
 * ```
 *
 * @see {@link https://effect.website | Effect}
 *
 * @packageDocumentation
 */

export { JsoncCodec } from "./JsoncCodec.js";
