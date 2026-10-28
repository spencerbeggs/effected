/**
 * YAML 1.2 parsing, editing and formatting as Effect schemas.
 *
 * @remarks
 * {@link Yaml} is the value-level facade (`parse`/`parseAll`/`stringify`,
 * comment stripping, semantic equality and the schema factories);
 * {@link YamlDocument} exposes the full parsed AST plus recovered
 * diagnostics; {@link YamlFormat} computes non-mutating format/modify edits
 * that preserve comments and whitespace; {@link YamlVisitor} streams
 * SAX-style AST events; {@link YamlTokens} exposes the positioned token
 * stream; {@link YamlLint} runs style rules, applies their fixes and infers a
 * config from observed style. All fallible entry points — parse, stringify, encode
 * and modify — carry typed errors built from {@link YamlDiagnostic}, never a
 * collapsed string reason or an unhandled defect on malformed or adversarial
 * input.
 *
 * Every position the package reports is a `LineIndex` position:
 * `YamlDiagnostic` is `LineIndex.make(text).positionAt(offset)`, while
 * `YamlToken` and lint diagnostics use `{ lineBreaks: "lf" }`, the composer's
 * rule, where a bare carriage return is line content. `LineIndex` and the
 * position shapes are re-exported from `@effected/source`, so a consumer
 * needs no second dependency to compute or name them.
 *
 * @packageDocumentation
 */

export {
	type LineBreaks,
	LineIndex,
	type LineIndexOptions,
	type SourceDiagnostic,
	type SourceIndex,
	type SourceLocation,
	type SourcePosition,
	type SourceRange,
	type SourceSpan,
} from "@effected/source";
export type { YamlBoundCodec } from "./Yaml.js";
export {
	Yaml,
	YamlParseError,
	YamlParseOptions,
	YamlStringifyError,
	YamlStringifyOptions,
} from "./Yaml.js";
export {
	YamlComposerErrorCode,
	YamlDiagnostic,
	YamlErrorCode,
	YamlLexErrorCode,
	YamlModifyErrorCode,
	YamlParseErrorCode,
	YamlStringifyErrorCode,
} from "./YamlDiagnostic.js";
export { YamlDirective, YamlDocument } from "./YamlDocument.js";
export type { YamlPath, YamlSegment } from "./YamlEdit.js";
export { YamlEdit, YamlRange } from "./YamlEdit.js";
export type { YamlRangeLike } from "./YamlFormat.js";
export { YamlFormat, YamlFormattingOptions, YamlModificationError } from "./YamlFormat.js";
export type { YamlLintInference } from "./YamlLint.js";
export {
	StyleConflict,
	StyleEvidence,
	StyleFloorTally,
	StyleVoteTally,
	YamlLint,
	YamlLintConfig,
	YamlLintRuleSetting,
	YamlStyleConflictError,
} from "./YamlLint.js";
export type { LintContext, LintLine, StyleObservation, YamlRule } from "./YamlLintRule.js";
export { StyleFloor, StyleVote, YamlLintDiagnostic, YamlLintSeverity } from "./YamlLintRule.js";
export type { YamlAliasEncoded, YamlMapEncoded, YamlScalarEncoded, YamlSeqEncoded } from "./YamlNode.js";
export {
	CollectionStyle,
	QuoteCompat,
	QuoteStyle,
	ScalarChomp,
	ScalarStyle,
	YamlAlias,
	YamlMap,
	YamlNode,
	YamlPair,
	YamlScalar,
	YamlSeq,
} from "./YamlNode.js";
export { YamlToken, YamlTokenKind, YamlTokens } from "./YamlToken.js";
export { YamlVisitor, YamlVisitorEvent } from "./YamlVisitor.js";
