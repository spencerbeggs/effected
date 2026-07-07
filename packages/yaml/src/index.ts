/**
 * Zero-dependency YAML parsing, editing and formatting as Effect schemas.
 *
 * @packageDocumentation
 */

export {
	Yaml,
	YamlParseError,
	YamlParseError_base,
	YamlParseOptions,
	YamlParseOptions_base,
	YamlStringifyError,
	YamlStringifyError_base,
	YamlStringifyOptions,
	YamlStringifyOptions_base,
} from "./Yaml.js";
export {
	YamlComposerErrorCode,
	YamlDiagnostic,
	YamlDiagnostic_base,
	YamlErrorCode,
	YamlLexErrorCode,
	YamlModifyErrorCode,
	YamlParseErrorCode,
	YamlStringifyErrorCode,
} from "./YamlDiagnostic.js";
export { YamlDirective, YamlDirective_base, YamlDocument, YamlDocument_base } from "./YamlDocument.js";
export type { YamlPath, YamlSegment } from "./YamlEdit.js";
export { YamlEdit, YamlEdit_base, YamlRange, YamlRange_base } from "./YamlEdit.js";
export type { YamlRangeLike } from "./YamlFormat.js";
export {
	YamlFormat,
	YamlFormattingOptions,
	YamlFormattingOptions_base,
	YamlModificationError,
	YamlModificationError_base,
} from "./YamlFormat.js";
export {
	CollectionStyle,
	ScalarChomp,
	ScalarStyle,
	YamlAlias,
	YamlAlias_base,
	YamlMap,
	YamlMap_base,
	YamlNode,
	YamlPair,
	YamlPair_base,
	YamlScalar,
	YamlScalar_base,
	YamlSeq,
	YamlSeq_base,
} from "./YamlNode.js";
export { YamlVisitor, YamlVisitorEvent } from "./YamlVisitor.js";
