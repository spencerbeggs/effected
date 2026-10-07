// The envelope layer: the one opinion this package imposes.
//
// Every line is an envelope — `at`, `event`, an optional `scope`, and the
// payload under `data` — and the payload is validated by the schema registered
// for its tag.
//
// The read path is **two stages**, and the split is what makes the package's
// headline property true: the frame decodes first with `data` left untouched,
// filtering reads only frame fields, and the registered payload schema applies
// **to selected lines only**. The envelope union is a derived *type*, never a
// `Schema.Union` value on the read path, because discriminating through a
// union would decode every line's payload eagerly.

import type { DateTime } from "effect";
import { DateTime as DateTimeValue, Option, Result, Schema } from "effect";
import type { DecodeError } from "./JsonlError.js";
import { InvalidData, UnknownEvent, UnserializableData } from "./JsonlError.js";
import type { DataSchema, JsonlEvent } from "./JsonlEvent.js";
import { Line, isBlank } from "./Line.js";
import type { LinePosition, LineSlice } from "./LineSlice.js";

/**
 * Stage one: the envelope with its payload left undecoded.
 *
 * A `Schema.Struct`, not a class: it runs for every line of every read,
 * including the lines a slice is about to discard. `data` is `Schema.Unknown`,
 * which passes the payload through without traversing it.
 */
const EnvelopeFrame = Schema.Struct({
	at: Schema.DateTimeUtcFromString,
	event: Schema.String,
	scope: Schema.optionalKey(Schema.String),
	data: Schema.Unknown,
});

/**
 * A decoded envelope frame — `data` still raw.
 *
 * @internal
 */
export type Frame = typeof EnvelopeFrame.Type;

/**
 * A decoded envelope: the frame, its validated payload, and where its line sits.
 *
 * A registry of event definitions derives a union of these discriminated on
 * `event`, so narrowing on the tag recovers the payload type registered for it.
 *
 * @public
 */
export interface Envelope<out Tag extends string, out Data> {
	/** UTC timestamp, assigned by the service at append time from the `Clock`. */
	readonly at: DateTime.Utc;
	/** The event tag: the union discriminant and the primary filter key. */
	readonly event: Tag;
	/** The partition key, with no further semantics. */
	readonly scope?: string | undefined;
	/** The payload, validated against the schema registered for `event`. */
	readonly data: Data;
	/** Where this envelope's line sits in the journal. `position.end` is the resume cursor. */
	readonly position: LinePosition;
}

/**
 * The envelope type derived from one event definition. Distributes over a union
 * of definitions, which is what turns a registry into a discriminated union.
 *
 * @public
 */
export type EnvelopeOf<E extends JsonlEvent.Any> =
	E extends JsonlEvent<infer Tag, infer Data extends DataSchema, boolean, boolean>
		? Envelope<Tag, Data["Type"]>
		: never;

/**
 * The discriminated union of every envelope a registry can carry.
 *
 * @public
 */
export type EnvelopeUnion<R extends JsonlEvent.Registry> = EnvelopeOf<JsonlEvent.Events<R>>;

/**
 * The envelope variant carrying a given tag — the type a slice narrows to.
 *
 * @public
 */
export type EnvelopeWithTag<R extends JsonlEvent.Registry, T extends string> = Extract<
	EnvelopeUnion<R>,
	{ readonly event: T }
>;

/**
 * The tag→definition lookup, built once per registry rather than once per line.
 *
 * A registry is an array declared at module scope and handed to every call, so
 * it is a legitimate cache key; `WeakMap` so a registry that goes out of scope
 * takes its index with it.
 */
const registryIndex = new WeakMap<JsonlEvent.Registry, Map<string, JsonlEvent.Any>>();

const indexRegistry = (events: JsonlEvent.Registry): Map<string, JsonlEvent.Any> => {
	let index = registryIndex.get(events);
	if (index === undefined) {
		// The registry is typed `ReadonlyArray`; freezing it enforces only what the
		// type claims, and turns a mutation after this lookup — which the cache
		// would otherwise silently ignore — into a loud `TypeError`.
		Object.freeze(events);
		index = new Map(events.map((event) => [event.tag, event] as const));
		registryIndex.set(events, index);
	}
	return index;
};

const decodeFrame = Schema.decodeUnknownResult(EnvelopeFrame);

const positionOf = (line: LineSlice): LinePosition => ({ offset: line.offset, end: line.end });

/**
 * Stage one only: parse a line and decode its frame, leaving `data` untouched.
 *
 * @internal
 */
export const frameResult = (line: LineSlice): Result.Result<Frame, DecodeError> => {
	const parsed = Line.parseResult(line);
	if (Result.isFailure(parsed)) {
		return Result.fail(parsed.failure);
	}
	const frame = decodeFrame(parsed.success);
	if (Result.isFailure(frame)) {
		return Result.fail(new InvalidData({ line, event: Option.none(), error: frame.failure }));
	}
	return Result.succeed(frame.success);
};

/**
 * Stage two: apply the registered payload schema to an already-decoded frame.
 *
 * The one payload-decode path; every decode, filtered or not, goes through it.
 *
 * @internal
 */
export const completeResult = <R extends JsonlEvent.Registry>(
	events: R,
	line: LineSlice,
	frame: Frame,
): Result.Result<EnvelopeUnion<R>, DecodeError> => {
	const { at, event, scope, data } = frame;
	const definition = indexRegistry(events).get(event);
	if (definition === undefined) {
		return Result.fail(new UnknownEvent({ line, event, known: events.map((e) => e.tag) }));
	}
	const decoded = Schema.decodeUnknownResult(definition.data)(data);
	if (Result.isFailure(decoded)) {
		return Result.fail(new InvalidData({ line, event: Option.some(event), error: decoded.failure }));
	}
	return Result.succeed({
		at,
		event,
		// A conditional spread, never an explicit `undefined` on an optional key.
		...(scope === undefined ? {} : { scope }),
		data: decoded.success,
		position: positionOf(line),
	} as EnvelopeUnion<R>);
};

/**
 * Decoding, encoding and the envelope-level walk-back.
 *
 * Every operation is synchronous and `Result`-based, so a hook script can read
 * a journal with no Effect runtime. Lift one into an `Effect` with
 * `Effect.fromResult` where a program needs it.
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
 *   current.value.data.round; // typed from the registered payload schema
 * }
 * ```
 *
 * @public
 */
export const Envelope = {
	/**
	 * Decode one line into a fully validated envelope.
	 *
	 * @param events - The registry defining which tags are legal and what their
	 *   payloads must look like.
	 * @param line - A slice from `Line.split`.
	 * @returns The envelope, or why the line is not one.
	 */
	decodeResult: <const R extends JsonlEvent.Registry>(
		events: R,
		line: LineSlice,
	): Result.Result<EnvelopeUnion<R>, DecodeError> => {
		const frame = frameResult(line);
		return Result.isFailure(frame) ? Result.fail(frame.failure) : completeResult(events, line, frame.success);
	},

	/**
	 * Decode every non-blank line, reporting failures rather than dropping them.
	 *
	 * A line that is not a legal envelope is a `Result` in the array, never a gap
	 * in it: whether a hole is tolerable is the caller's decision.
	 *
	 * @param events - The registry to validate against.
	 * @param text - JSONL source text.
	 * @param base - The byte offset `text` starts at in its file.
	 * @returns One `Result` per non-blank line, in file order.
	 */
	decodeAllResult: <const R extends JsonlEvent.Registry>(
		events: R,
		text: string,
		base = 0,
	): ReadonlyArray<Result.Result<EnvelopeUnion<R>, DecodeError>> =>
		Line.split(text, base)
			.filter((line) => !isBlank(line))
			.map((line) => Envelope.decodeResult(events, line)),

	/**
	 * Walk back from the end to the last valid **envelope** — the journal's
	 * current state.
	 *
	 * A torn tail is stepped over, and so is any number of malformed, foreign or
	 * blank trailing lines. Validity is judged at the envelope, not merely as
	 * JSON: a torn *scalar* (`42` cut mid-write leaves `4`) parses cleanly as a
	 * different value, but is not an envelope. Decoding stops at the first
	 * success, so the cost tracks the damage at the tail, not the file's age.
	 *
	 * @param events - The registry to validate against.
	 * @param text - JSONL source text — the whole file, or a tail of it that
	 *   begins at a line boundary.
	 * @param base - The byte offset `text` starts at in its file.
	 * @returns The last valid envelope, or `Option.none()` if there is none.
	 */
	lastValid: <const R extends JsonlEvent.Registry>(
		events: R,
		text: string,
		base = 0,
	): Option.Option<EnvelopeUnion<R>> => {
		const lines = Line.split(text, base);
		for (let index = lines.length - 1; index >= 0; index--) {
			const line = lines[index] as LineSlice;
			if (isBlank(line)) {
				continue;
			}
			const decoded = Envelope.decodeResult(events, line);
			if (Result.isSuccess(decoded)) {
				return Option.some(decoded.success);
			}
		}
		return Option.none();
	},

	/**
	 * Encode one envelope into a complete JSONL line, terminator included.
	 *
	 * The trailing `\n` is part of the returned string on purpose: the
	 * cooperative-writer contract is one write of a *complete line*, and an API
	 * returning the text without its terminator would invite writing the two
	 * separately.
	 *
	 * @param events - The registry to validate against.
	 * @param envelope - The event tag, its payload, the timestamp, and an
	 *   optional scope.
	 * @returns The encoded line, or `InvalidData` when the payload does not
	 *   satisfy its schema, `UnserializableData` when the encoded payload is not
	 *   JSON (a bigint or a reference cycle), or `UnknownEvent` for a tag the
	 *   registry does not define.
	 */
	encodeResult: <const R extends JsonlEvent.Registry, const T extends JsonlEvent.Tag<R>>(
		events: R,
		envelope: {
			readonly event: T;
			readonly data: JsonlEvent.Data<R, T>;
			readonly at: DateTime.Utc;
			readonly scope?: string | undefined;
		},
	): Result.Result<string, UnknownEvent | InvalidData | UnserializableData> => {
		const definition = indexRegistry(events).get(envelope.event);
		if (definition === undefined) {
			return Result.fail(new UnknownEvent({ event: envelope.event, known: events.map((e) => e.tag) }));
		}
		const data = Schema.encodeUnknownResult(definition.data)(envelope.data);
		if (Result.isFailure(data)) {
			return Result.fail(new InvalidData({ event: Option.some(envelope.event), error: data.failure }));
		}
		// `JSON.stringify` throws on a bigint or a reference cycle, and a payload
		// schema is free to admit both; caught here so it stays in the typed
		// channel instead of escaping as a defect.
		try {
			const text = JSON.stringify({
				at: DateTimeValue.formatIso(envelope.at),
				event: envelope.event,
				...(envelope.scope === undefined ? {} : { scope: envelope.scope }),
				// `data` is required on the frame. `Schema.Void` encodes to
				// `undefined`, which `JSON.stringify` would drop with its key; `null`
				// is JSON's spelling of absence.
				data: data.success === undefined ? null : data.success,
			});
			return Result.succeed(`${text}\n`);
		} catch (cause) {
			return Result.fail(new UnserializableData({ event: envelope.event, cause }));
		}
	},
} as const;
