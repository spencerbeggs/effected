/**
 * The YAML codec for `@effected/config-file`, backed by `@effected/yaml`.
 *
 * @remarks
 * `@effected/yaml` is an optional peer: install it beside `@effected/config-file` to use this entrypoint. The
 * package root never reaches it, so a consumer that reads only JSON installs and loads no YAML engine.
 *
 * @packageDocumentation
 */
export { YamlCodec } from "./YamlCodec.js";
