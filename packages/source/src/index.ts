/**
 * Source-text positions as plain values, with no dependencies and no IO.
 *
 * {@link LineIndex} is a line table over one text: offset to zero-based
 * `{ line, character }` and back, in UTF-16 code units, with LSP's line
 * terminators by default; {@link SourceIndex} is its public surface as a
 * structural interface, the type to name in a signature so that two
 * installed copies of this package interoperate. {@link SourcePosition}, {@link SourceRange},
 * {@link SourceSpan}, {@link SourceLocation} and {@link SourceDiagnostic} are
 * the structural shapes the kit's format packages already share, so a
 * consumer can be written once over any of them.
 *
 * @packageDocumentation
 */

export { type LineBreaks, LineIndex, type LineIndexOptions } from "./LineIndex.js";
export type { SourceDiagnostic, SourceLocation } from "./SourceDiagnostic.js";
export type { SourceIndex } from "./SourceIndex.js";
export type { SourcePosition } from "./SourcePosition.js";
export type { SourceRange } from "./SourceRange.js";
export type { SourceSpan } from "./SourceSpan.js";
