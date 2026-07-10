/**
 * Zero-dependency TOML 1.0.0 parsing and stringification as Effect schemas.
 *
 * @remarks
 * {@link Toml} is the value-level facade (`parse`/`stringify` and the schema
 * factories); {@link TomlDiagnostic} is the structured diagnostic every
 * failure carries; the `TomlNode` classes are the lossless linear CST; the
 * four `TomlDateTime` classes model TOML's date-time types. All fallible
 * entry points — parse, stringify and the codec directions — carry typed
 * errors built from {@link TomlDiagnostic}, never a collapsed string reason
 * or an unhandled defect on malformed or adversarial input.
 *
 * @packageDocumentation
 */

export { Toml, TomlParseError, TomlStringifyError, TomlStringifyOptions } from "./Toml.js";
export { TomlLocalDate, TomlLocalDateTime, TomlLocalTime, TomlOffsetDateTime } from "./TomlDateTime.js";
export {
	TomlDiagnostic,
	TomlErrorCode,
	TomlLexErrorCode,
	TomlParseErrorCode,
	TomlSemanticErrorCode,
	TomlStringifyErrorCode,
} from "./TomlDiagnostic.js";
export { TomlDocument } from "./TomlDocument.js";
export type { TomlPath, TomlSegment } from "./TomlEdit.js";
export { TomlEdit, TomlRange } from "./TomlEdit.js";
export type { TomlRangeLike } from "./TomlFormat.js";
export { TomlFormat, TomlFormattingOptions, TomlModificationError } from "./TomlFormat.js";
export {
	TomlArray,
	TomlArrayTableHeader,
	TomlBoolean,
	TomlDateTimeLiteral,
	TomlExpression,
	TomlFloat,
	TomlInlineEntry,
	TomlInlineTable,
	TomlInteger,
	TomlKey,
	TomlKeyKind,
	TomlKeyValue,
	TomlString,
	TomlStringStyle,
	TomlTableHeader,
	TomlTrivia,
	TomlValueNode,
} from "./TomlNode.js";
export { TomlVisitor, TomlVisitorEvent } from "./TomlVisitor.js";
