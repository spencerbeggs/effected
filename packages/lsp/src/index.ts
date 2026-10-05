/**
 * Language Server Protocol base-protocol framing for Effect v4: encode a
 * message as a `Content-Length` frame, and decode bytes into messages
 * incrementally, as a pure function or a `Stream` transform.
 *
 * @remarks
 * Test tooling lives behind `@effected/lsp/testing` (`LspProbe`), so it never
 * enters a runtime import graph.
 *
 * @packageDocumentation
 */
export { LspFrame, type LspFrameDecoded, LspFrameError, LspFrameErrorCode } from "./LspFrame.js";
export type { LspMessage } from "./LspMessage.js";
