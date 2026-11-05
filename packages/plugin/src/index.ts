/**
 * The effected carrier. Installing it provides the `effected` command and the
 * `effected-mcp` server, each reporting that it came through this package, and
 * `defineSchemastore` for a `schemastore.config.ts`.
 *
 * @remarks
 * A config file imports this entry, so it stays cheap: it reaches neither front
 * end, nor `ajv`, nor Ink.
 *
 * @packageDocumentation
 */

export { defineConfig as defineSchemastore } from "@effected/schemastore";
export { PLUGIN_VERSION } from "./version.js";
