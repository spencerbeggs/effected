/**
 * The boundary layer of an `effect/unstable/ai` MCP server: stdio wiring that
 * keeps stdout the JSON-RPC wire, tool-failure shaping, and strict-input
 * walkers. Protocol handling, tool registration and the wire format stay
 * core's; this package fixes the defaults consumers kept getting wrong.
 *
 * @packageDocumentation
 */
export { ToolFailure } from "./ToolFailure.js";
export { type FormatUnknownKeysOptions, ToolInputSchema, type UnknownKeysLevel } from "./ToolInputSchema.js";
