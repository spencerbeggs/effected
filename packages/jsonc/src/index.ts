/**
 * Zero-dependency JSONC parsing, editing and formatting as Effect schemas.
 *
 * Parse JSONC into values or an AST, strip comments offset-preservingly,
 * compute byte-minimal edits, format, modify by path and visit as a `Stream` —
 * all pure (no IO), with a single aggregate parse error and string→domain
 * schema factories.
 *
 * @example
 * ```ts
 * import { Jsonc } from "@effected/jsonc";
 * import { Effect, Schema } from "effect";
 *
 * const Config = Schema.Struct({ port: Schema.Number });
 * const ConfigFromJsonc = Jsonc.schema(Config);
 *
 * const program = Effect.gen(function* () {
 *   const config = yield* Schema.decodeUnknownEffect(ConfigFromJsonc)('{ "port": 3000 // dev\n }');
 *   return config; // { port: 3000 }
 * });
 * ```
 *
 * @see {@link https://effect.website | Effect}
 *
 * @packageDocumentation
 */

export {
	Jsonc,
	JsoncParseError,
	JsoncParseErrorCode,
	JsoncParseErrorDetail,
	JsoncParseErrorDetail_base,
	JsoncParseError_base,
	JsoncParseOptions,
	JsoncParseOptions_base,
} from "./Jsonc.js";
export {
	JsoncEdit,
	JsoncEdit_base,
	JsoncFormattingOptions,
	JsoncFormattingOptions_base,
	JsoncRange,
	JsoncRange_base,
} from "./JsoncEdit.js";
export { JsoncFormatter } from "./JsoncFormatter.js";
export {
	JsoncModificationError,
	JsoncModificationError_base,
	JsoncModifier,
	type JsoncModifyOptions,
} from "./JsoncModifier.js";
export { JsoncNode, JsoncNodeType, JsoncNode_base, type JsoncPath, type JsoncSegment } from "./JsoncNode.js";
export { JsoncVisitor, JsoncVisitorEvent } from "./JsoncVisitor.js";
