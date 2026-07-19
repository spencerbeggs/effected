/**
 * Zero-dependency YAML 1.2 parsing, editing and formatting as Effect schemas.
 *
 * @remarks
 * {@link Yaml} is the value-level facade (`parse`/`parseAll`/`stringify`,
 * comment stripping, semantic equality and the schema factories);
 * {@link YamlDocument} exposes the full parsed AST plus recovered
 * diagnostics; {@link YamlFormat} computes non-mutating format/modify edits
 * that preserve comments and whitespace; {@link YamlVisitor} streams
 * SAX-style AST events. All fallible entry points — parse, stringify, encode
 * and modify — carry typed errors built from {@link YamlDiagnostic}, never a
 * collapsed string reason or an unhandled defect on malformed or adversarial
 * input.
 *
 * @packageDocumentation
 */

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
export {
	CollectionStyle,
	ScalarChomp,
	ScalarStyle,
	YamlAlias,
	YamlMap,
	YamlNode,
	YamlPair,
	YamlScalar,
	YamlSeq,
} from "./YamlNode.js";
export { YamlVisitor, YamlVisitorEvent } from "./YamlVisitor.js";
