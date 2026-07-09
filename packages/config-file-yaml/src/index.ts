/**
 * A `ConfigCodec` adapter plugging `@effected/yaml` into
 * `@effected/config-file`'s codec seam: YAML as configuration file content.
 *
 * @example
 * ```ts
 * import { YamlCodec } from "@effected/config-file-yaml";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const value = yield* YamlCodec.parse("port: 3000\nhost: localhost\n");
 *   return value; // { port: 3000, host: "localhost" }
 * });
 * ```
 *
 * @see {@link https://effect.website | Effect}
 *
 * @packageDocumentation
 */

export { YamlCodec } from "./YamlCodec.js";
