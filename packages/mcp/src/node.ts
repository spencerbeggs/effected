/**
 * The Node-only part of `@effected/mcp`: {@link StdioCapture}, which keeps an
 * in-process library's stdout off the JSON-RPC wire for one async context.
 *
 * @remarks
 * A separate entrypoint because it imports `node:async_hooks`, which the
 * platform-neutral root must never load. `__test__/entrypoints.test.ts` pins
 * that the root never reaches this module.
 *
 * @packageDocumentation
 */
export {
	StdioCapture,
	type StdioCaptureHost,
	type StdioCaptureOptions,
	type StdioSink,
} from "./StdioCapture.js";
