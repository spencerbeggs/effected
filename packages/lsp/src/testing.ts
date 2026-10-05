/**
 * Test tooling for Language Server bins: `LspProbe`, the packed-install
 * proof that a server boots and completes the LSP lifecycle over stdio, and
 * `LspProcess`, a spawned server a test drives frame by frame, with a stdout
 * hygiene check.
 *
 * @remarks
 * A separate entrypoint, so a runtime import graph never loads test code.
 * This module is an entry point that api-extractor models as its own
 * surface, so every type its signatures name is re-exported here.
 *
 * @packageDocumentation
 */
export type { LspMessage } from "./LspMessage.js";
export { LspProbe, type LspProbeOptions, type LspProbeResult } from "./LspProbe.js";
export { LspProcess, type LspProcessStderrUntilOptions } from "./LspProcess.js";
export { LspTestFailure } from "./LspTestFailure.js";
