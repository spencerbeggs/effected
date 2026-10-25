/**
 * The TOML codec for `@effected/config-file`, backed by `@effected/toml`.
 *
 * @remarks
 * `@effected/toml` is an optional peer: install it beside `@effected/config-file` to use this entrypoint. The
 * package root never reaches it, so a consumer that reads only JSON installs and loads no TOML engine.
 *
 * @packageDocumentation
 */
export { TomlCodec } from "./TomlCodec.js";
