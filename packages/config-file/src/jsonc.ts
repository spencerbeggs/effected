/**
 * The JSONC codec for `@effected/config-file`, backed by `@effected/jsonc`.
 *
 * @remarks
 * `@effected/jsonc` is an optional peer: install it beside `@effected/config-file` to use this entrypoint. The
 * package root never reaches it, so a consumer that reads only JSON installs and loads no JSONC engine.
 *
 * @packageDocumentation
 */
export { JsoncCodec } from "./JsoncCodec.js";
