/**
 * Test clients for MCP servers built on `effect/unstable/ai`: an in-process
 * harness over queue-backed stdio, a spawned-bin client that never hangs, a
 * packed-install initialize probe, and a pure tools/list audit.
 *
 * @remarks
 * A separate entrypoint, so a server's runtime import graph never loads test
 * code. See the reachability test beside it.
 *
 * @packageDocumentation
 */
export { McpHarness, type McpHarnessOptions } from "./McpHarness.js";
export { McpProbe, type McpProbeOptions, type McpProbeResult } from "./McpProbe.js";
export { McpProcess } from "./McpProcess.js";
export { McpTestFailure } from "./McpTestFailure.js";
export type { JsonRpcMessage, ServedTool } from "./McpWire.js";
