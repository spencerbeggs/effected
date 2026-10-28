// A credential-free copy of what octokit throws, for keeping as an error's
// `cause`.
//
// `@octokit/request-error` redacts the `authorization` header's credential and
// the `client_secret` / `access_token` query values, and nothing else. Its
// `request` still carries the whole request BODY (a webhook `config.secret`, a
// GraphQL document's variables), every other request header, and the
// per-request options; its `response` carries every response header,
// `set-cookie` included, and the parsed body. `@octokit/graphql`'s
// `GraphqlResponseError` (and the transport's own throw for a 200 with
// `errors`) adds `headers` and the partial `data`. A logger or serializer that
// walks the kept cause reads all of it.
//
// Structural on purpose, as `readThrowable` is: `@octokit/request-error` is a
// transitive dependency this package does not declare.

import { HttpRedaction } from "@effected/crypto";

const REDACTED = "REDACTED";

const MAX_DEPTH = 8;

type Primitive = string | number | boolean;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const define = (target: object, key: string, value: unknown): void => {
	Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
};

/** Strings through `HttpRedaction.text`, numbers and booleans as they are, everything else dropped. */
const primitive = (value: unknown): Primitive | undefined =>
	typeof value === "string"
		? HttpRedaction.text(value)
		: typeof value === "number" || typeof value === "boolean"
			? value
			: undefined;

/** A header record minus cookies, every sensitive value `REDACTED`. */
const headers = (input: unknown): Record<string, Primitive> | undefined => {
	const record = asRecord(input);
	if (record === undefined) return undefined;
	const out: Record<string, Primitive> = {};
	for (const [name, value] of Object.entries(record)) {
		const lower = name.toLowerCase();
		if (lower === "set-cookie" || lower === "cookie") continue;
		const kept = primitive(value);
		if (kept === undefined) continue;
		out[name] = HttpRedaction.isSensitiveHeader(lower) ? REDACTED : kept;
	}
	return out;
};

/** The top-level primitive fields of a record (`message`, `documentation_url`, `status`); nested values dropped. */
const primitives = (input: unknown): Record<string, Primitive> | undefined => {
	const record = asRecord(input);
	if (record === undefined) return undefined;
	const out: Record<string, Primitive> = {};
	for (const [key, value] of Object.entries(record)) {
		const kept = primitive(value);
		if (kept !== undefined) out[key] = kept;
	}
	return out;
};

const optional = (key: string, value: unknown): Record<string, unknown> =>
	value === undefined ? {} : { [key]: value };

const copy = (value: unknown, depth: number): unknown => {
	if (typeof value === "string") return HttpRedaction.text(value);
	if (value === null || typeof value !== "object") return value;
	if (depth >= MAX_DEPTH) return undefined;
	const source = value as Record<string, unknown>;
	// Same prototype, so `instanceof RequestError` still answers as it did.
	const out: Error =
		value instanceof Error
			? Object.create(Object.getPrototypeOf(value))
			: new Error(
					HttpRedaction.text(
						typeof source.message === "string" ? source.message : Object.prototype.toString.call(value),
					),
				);
	if (value instanceof Error) {
		Object.defineProperty(out, "message", {
			value: HttpRedaction.text(value.message),
			writable: true,
			configurable: true,
		});
		if (value.stack !== undefined) {
			Object.defineProperty(out, "stack", {
				value: HttpRedaction.text(value.stack),
				writable: true,
				configurable: true,
			});
		}
	}
	for (const [key, field] of Object.entries(source)) {
		if (key === "message" || key === "stack" || key === "cause") continue;
		const kept = primitive(field);
		if (kept !== undefined) define(out, key, kept);
	}
	const request = asRecord(source.request);
	if (request !== undefined) {
		define(out, "request", {
			...optional("method", typeof request.method === "string" ? request.method : undefined),
			...optional("url", typeof request.url === "string" ? HttpRedaction.url(request.url) : undefined),
			...optional("headers", headers(request.headers)),
		});
	}
	const response = asRecord(source.response);
	if (response !== undefined) {
		define(out, "response", {
			...optional("url", typeof response.url === "string" ? HttpRedaction.url(response.url) : undefined),
			...optional("status", typeof response.status === "number" ? response.status : undefined),
			...optional("headers", headers(response.headers)),
			...optional("data", primitives(response.data)),
		});
	}
	if (source.headers !== undefined) {
		const kept = headers(source.headers);
		if (kept !== undefined) define(out, "headers", kept);
	}
	if (source.cause !== undefined) {
		const nested = copy(source.cause, depth + 1);
		if (nested !== undefined) define(out, "cause", nested);
	}
	return out;
};

/**
 * Sanitize what octokit threw before keeping it as a cause.
 *
 * @remarks
 * A value carrying a `request`, `response` or `headers` field — octokit's
 * `RequestError`, a `GraphqlResponseError`, the transport's own GraphQL throw
 * — becomes a copy on the same prototype that keeps `name`, `message`,
 * `status` and the other primitive fields, the request's method, redacted url
 * and headers, and the response's redacted url, status, headers minus
 * `set-cookie` and the top-level primitive fields of its body (`message`,
 * `documentation_url`). Every sensitive header value reads `REDACTED`. The
 * request body, the per-request options, the GraphQL variables and partial
 * `data`, and the nested `errors` arrays are dropped: the facts a caller
 * routes on (`validation`, `errors`) were already read off the original.
 *
 * Anything else — an `AbortError`, a kit error, a plain object a test throws
 * — is returned unchanged, by identity.
 */
export const scrubThrowable = (error: unknown): unknown => {
	const record = asRecord(error);
	if (record === undefined) return error;
	return record.request !== undefined || record.response !== undefined || record.headers !== undefined
		? copy(error, 0)
		: error;
};
