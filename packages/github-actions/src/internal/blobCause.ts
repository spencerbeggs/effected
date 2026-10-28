// A credential-free copy of what an Azure blob client throws, for keeping as
// `BlobTransferError.cause`.
//
// `@azure/core-rest-pipeline`'s `RestError` sanitizes itself only when it is
// RENDERED (`util.inspect`, `toJSON`). Its non-enumerable `request.url` still
// holds the signed url the results backend handed out, `sig` and `skoid`
// included, and `details` plus `response.headers` hold the response's
// `set-cookie`. A logger or serializer that walks the object reads them all.
//
// Structural on purpose: importing `RestError` would put `@azure/*` on the
// graph of this helper, and `__test__/reachability.test.ts` holds Azure to the
// three transfer modules.

import { HttpRedaction } from "@effected/crypto";
import { Predicate } from "effect";
import { UrlParams } from "effect/http";

const REDACTED = "REDACTED";

// The shared-access-signature fields that sign, scope or identify: the
// signature itself, the expiry and start, the permissions, and the user
// delegation key's object, tenant and validity. `sv`, `sr`, `spr`, `sks` and
// `skv` stay, because they are what tells a human which kind of url it was.
const SAS_NAMES: ReadonlyArray<string> = [
	"sig",
	"se",
	"st",
	"sp",
	"sip",
	"skoid",
	"sktid",
	"skt",
	"ske",
	"saoid",
	"suoid",
	"scid",
];

/** A signed blob url with its SAS credential fields and userinfo redacted. */
export const blobUrl = (raw: string): string => UrlParams.redactUrl(HttpRedaction.url(raw), SAS_NAMES);

const text = (raw: string): string =>
	HttpRedaction.text(raw).replace(/https?:\/\/[^\s"'<>`]+/gi, (match) => UrlParams.redactUrl(match, SAS_NAMES));

/** A header record (`details`, or a response's headers) minus cookies, sensitive values redacted. */
const headerRecord = (input: unknown): Record<string, string | number | boolean> | undefined => {
	const entries = headerEntries(input);
	if (entries === undefined) return undefined;
	const out: Record<string, string | number | boolean> = {};
	for (const [name, value] of entries) {
		const lower = name.toLowerCase();
		if (lower === "set-cookie" || lower === "cookie") continue;
		if (typeof value === "string") out[name] = HttpRedaction.isSensitiveHeader(lower) ? REDACTED : text(value);
		else if (Predicate.isNumber(value) || Predicate.isBoolean(value)) out[name] = value;
	}
	return out;
};

// `HttpHeaders` hides its values behind `toJSON()`; `details` is a plain record.
const headerEntries = (input: unknown): ReadonlyArray<readonly [string, unknown]> | undefined => {
	if (input === null || typeof input !== "object") return undefined;
	if (Predicate.hasProperty(input, "toJSON") && typeof input.toJSON === "function") {
		const json: unknown = input.toJSON();
		return json !== null && typeof json === "object" ? Object.entries(json) : undefined;
	}
	return Object.entries(input);
};

const isRestShaped = (value: object): boolean =>
	Predicate.hasProperty(value, "request") || Predicate.hasProperty(value, "response");

const MAX_DEPTH = 8;

const define = (target: object, key: string, value: unknown, enumerable: boolean): void => {
	Object.defineProperty(target, key, { value, enumerable, writable: true, configurable: true });
};

const copy = (value: unknown, depth: number): unknown => {
	if (typeof value === "string") return text(value);
	if (value === null || typeof value !== "object") return value;
	if (depth >= MAX_DEPTH) return undefined;
	const source = value as Record<string, unknown>;
	// Same prototype, so `instanceof RestError` and `isRestError` still answer.
	const out: Error =
		value instanceof Error
			? Object.create(Object.getPrototypeOf(value))
			: new Error(text(typeof source.message === "string" ? source.message : Object.prototype.toString.call(value)));
	if (value instanceof Error) {
		define(out, "message", text(value.message), false);
		if (value.stack !== undefined) define(out, "stack", text(value.stack), false);
	}
	for (const [key, field] of Object.entries(source)) {
		if (key === "details") {
			const details = headerRecord(field);
			if (details !== undefined) define(out, key, details, true);
		} else if (typeof field === "string") define(out, key, text(field), true);
		else if (Predicate.isNumber(field) || Predicate.isBoolean(field)) define(out, key, field, true);
	}
	const request = Predicate.hasProperty(value, "request") ? asRecord(value.request) : undefined;
	if (request !== undefined) {
		define(
			out,
			"request",
			{
				...(typeof request.method === "string" ? { method: request.method } : {}),
				...(typeof request.url === "string" ? { url: blobUrl(request.url) } : {}),
				...(headerRecord(request.headers) !== undefined ? { headers: headerRecord(request.headers) } : {}),
			},
			false,
		);
	}
	const response = Predicate.hasProperty(value, "response") ? asRecord(value.response) : undefined;
	if (response !== undefined) {
		define(
			out,
			"response",
			{
				...(Predicate.isNumber(response.status) ? { status: response.status } : {}),
				...(headerRecord(response.headers) !== undefined ? { headers: headerRecord(response.headers) } : {}),
			},
			false,
		);
	}
	if (Predicate.hasProperty(value, "cause") && value.cause !== undefined) {
		const nested = copy(value.cause, depth + 1);
		if (nested !== undefined) define(out, "cause", nested, true);
	}
	return out;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

/**
 * Sanitize what a blob transfer threw before keeping it as a cause: a
 * `RestError`-shaped value (one carrying a `request` or `response`) becomes a
 * copy on the same prototype that keeps `name`, `message`, `code`,
 * `statusCode`, the method, the url with its SAS credential fields redacted,
 * and the headers minus `set-cookie`, with sensitive values redacted; the
 * request and response bodies, the pipeline options and the raw url are gone.
 * Anything else — a filesystem error writing the download, a kit error — is
 * returned unchanged, by identity.
 */
export const blobCause = (cause: unknown): unknown =>
	cause !== null && typeof cause === "object" && isRestShaped(cause) ? copy(cause, 0) : cause;
