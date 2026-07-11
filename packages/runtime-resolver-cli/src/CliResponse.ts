/**
 * The JSON envelope the CLI prints.
 *
 * This is a consumed contract — CI jobs parse it — so it stays close to the v3
 * shape: an `ok` discriminator and a per-runtime results map. It is a schema
 * rather than an ad-hoc object literal, which is what lets `--schema` derive the
 * published JSON Schema from the same source of truth the writer uses.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";

/**
 * A structured error, as the envelope carries it.
 *
 * The `_tag` is the stable thing a caller branches on. The remaining fields are
 * whatever the error class declared — `retryAfter` on a rate limit, `constraint`
 * on a not-found — rather than a prose message that has to be parsed back apart.
 *
 * @public
 */
export const CliErrorDetail = Schema.Record(Schema.String, Schema.Unknown);

/**
 * A structured error, as the envelope carries it.
 *
 * @public
 */
export type CliErrorDetail = typeof CliErrorDetail.Type;

/**
 * One runtime resolved successfully.
 *
 * @public
 */
export const CliRuntimeSuccess = Schema.Struct({
	ok: Schema.Literal(true),
	/** Whether the data came from a live feed or the bundled snapshot. */
	source: Schema.String,
	/** Every matching version, newest first. */
	versions: Schema.Array(Schema.String),
	/** The newest matching version. */
	latest: Schema.String,
	/** The newest matching LTS version. Node only. */
	lts: Schema.optionalKey(Schema.String),
	/** The resolved default version. */
	default: Schema.optionalKey(Schema.String),
});

/**
 * One runtime resolved successfully.
 *
 * @public
 */
export type CliRuntimeSuccess = typeof CliRuntimeSuccess.Type;

/**
 * One runtime failed to resolve.
 *
 * @public
 */
export const CliRuntimeFailure = Schema.Struct({
	ok: Schema.Literal(false),
	error: CliErrorDetail,
});

/**
 * One runtime failed to resolve.
 *
 * @public
 */
export type CliRuntimeFailure = typeof CliRuntimeFailure.Type;

/**
 * The outcome for a single runtime.
 *
 * @public
 */
export const CliRuntimeResult = Schema.Union([CliRuntimeSuccess, CliRuntimeFailure]);

/**
 * The outcome for a single runtime.
 *
 * @public
 */
export type CliRuntimeResult = typeof CliRuntimeResult.Type;

/**
 * The whole response.
 *
 * Each runtime is resolved independently, so one failing does not suppress the
 * others: `ok` is false when any of them failed, and `results` still carries
 * every outcome.
 *
 * @public
 */
export const CliResponse = Schema.Struct({
	ok: Schema.Boolean,
	results: Schema.Record(Schema.String, CliRuntimeResult),
});

/**
 * The whole response.
 *
 * @public
 */
export type CliResponse = typeof CliResponse.Type;

/**
 * Flatten a domain error into the envelope's error shape.
 *
 * Errors are `Schema.TaggedErrorClass` instances carrying structured fields, so
 * the serializer copies those fields verbatim beside the `_tag`. v3 emitted a
 * free-text `message` here and callers had to parse it; the fields are the
 * message now.
 *
 * @public
 */
export const serializeError = (error: unknown): CliErrorDetail => {
	if (typeof error !== "object" || error === null) {
		return { _tag: "UnknownError", detail: String(error) };
	}

	const record = error as Record<string, unknown>;
	const tag = typeof record._tag === "string" ? record._tag : "UnknownError";
	const detail: Record<string, unknown> = { _tag: tag };

	for (const key of Object.keys(record)) {
		// `cause` holds an arbitrary throwable that will not survive JSON, and
		// `message`/`stack` are Error-plumbing rather than domain data.
		if (key === "_tag" || key === "cause" || key === "stack" || key === "message") continue;
		const value = record[key];
		if (value !== undefined) detail[key] = value;
	}

	return detail;
};
