/**
 * Crash guards for an MCP server process: `McpGuard.run` listens for stray
 * exceptions and rejections before the server's module graph loads, then
 * launches the server. This entrypoint has no static runtime import.
 *
 * @packageDocumentation
 */
export {
	McpGuard,
	type McpGuardHost,
	type McpGuardPolicy,
	type McpGuardRunOptions,
	type McpGuardedServer,
} from "./McpGuard.js";
