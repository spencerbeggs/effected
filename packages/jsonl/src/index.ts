/**
 * Append-only, schema-validated JSONL journals as a definable Effect service.
 *
 * The subject is not the format — one JSON value per line needs no library.
 * The subject is the file as a live object: a journal that only ever grows,
 * whose current state is its last valid line, whose tail may be torn mid-append,
 * and which several processes read while one writes.
 *
 * The pure core is synchronous and `Result`-based so a hook script can read the
 * current state of a journal with no Effect runtime at all.
 *
 * @example
 * ```ts
 * import { Envelope, JsonlEvent } from "@effected/jsonl";
 * import { Option, Schema } from "effect";
 *
 * const events = [JsonlEvent.make("state", { data: Schema.Struct({ round: Schema.Number }) })] as const;
 *
 * declare const sourceText: string;
 *
 * // The whole read path for a snapshot journal, with no runtime.
 * const current = Envelope.lastValid(events, sourceText);
 * if (Option.isSome(current)) {
 *   current.value.data.round; // the decoded payload of the last valid envelope
 *   current.value.position.end; // a resumable cursor
 * }
 * ```
 *
 * @see {@link https://effect.website | Effect}
 *
 * @packageDocumentation
 */

// `Envelope`, `JsonlEvent` and `LineSlice` each carry BOTH a value and a type
// declaration, so one export name covers the value and the type.
export type { EnvelopeOf, EnvelopeUnion, EnvelopeWithTag } from "./Envelope.js";
export { Envelope } from "./Envelope.js";
export type { AppendError, AppendOptions, ChangesError, JournalConfig, QueryError } from "./internal/engine.js";
export type { JournalClass, JournalShape } from "./Journal.js";
export { Journal } from "./Journal.js";
export type { DecodeError, JsonlError } from "./JsonlError.js";
export {
	InvalidData,
	JournalClosed,
	JournalNotFound,
	JournalResync,
	MalformedLine,
	TerminalViolation,
	UnknownEvent,
	UnserializableData,
} from "./JsonlError.js";
export type { DataSchema } from "./JsonlEvent.js";
export { JsonlEvent } from "./JsonlEvent.js";
export { Line } from "./Line.js";
export type { LinePosition } from "./LineSlice.js";
export { LineSlice } from "./LineSlice.js";
export type { Slice } from "./Slice.js";
