import { Option, Predicate } from "effect";
import { Headers, HttpBody, HttpClientError, HttpClientRequest, HttpClientResponse, UrlParams } from "effect/http";

/**
 * The value written in place of a sensitive header or query parameter.
 */
const REDACTED = "REDACTED";

const SENSITIVE_HEADERS: ReadonlyArray<string | RegExp> = [
	"authorization",
	"proxy-authorization",
	"cookie",
	"set-cookie",
	"x-api-key",
	"private-token",
	// `x-auth-token`, `x-github-token`, `x-amz-security-token`,
	// `x-goog-api-key`, `x-hub-signature-256`, `x-npm-otp`-style headers.
	/^x-(?:.+-)?(?:token|api-?key|secret|signature(?:-\d+)?|auth(?:orization)?|credentials?|otp|password)$/i,
];

const SENSITIVE_QUERY_NAMES: ReadonlyArray<string | RegExp> = [
	// Core's own `UrlParams.CurrentRedactedNames` defaults (which include the
	// SigV4 presigned-URL set and Azure SAS `sig`).
	"X-Amz-Signature",
	"X-Amz-Credential",
	"X-Amz-Security-Token",
	"AWSAccessKeyId",
	"Signature",
	"sig",
	"X-Goog-Signature",
	// Bearer-shaped tokens and secrets carried in a query string.
	"token",
	/^(?:access|refresh|id|session|auth)[_-]?token$/i,
	/^api[_-]?key$/i,
	/^client[_-]?secret$/i,
	"secret",
	"password",
	"code",
];

const isSensitiveHeader = (name: string): boolean => Headers.isRedactedName(name, SENSITIVE_HEADERS);

const url = (raw: string): string => {
	const hash = raw.indexOf("#");
	const head = UrlParams.redactUrl(hash === -1 ? raw : raw.slice(0, hash), SENSITIVE_QUERY_NAMES);
	if (hash === -1) return head;
	// Core leaves the fragment alone; an implicit-grant redirect carries
	// `#access_token=…` there, so it is redacted as a query string.
	return `${head}#${UrlParams.redactUrl(`?${raw.slice(hash + 1)}`, SENSITIVE_QUERY_NAMES).slice(1)}`;
};

const URL_IN_TEXT = /[a-z][a-z\d+.-]*:\/\/[^\s"'<>`]+/gi;
const BEARER_IN_TEXT = /\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/g;

const text = (raw: string): string =>
	raw.replace(URL_IN_TEXT, (match) => url(match)).replace(BEARER_IN_TEXT, (_match, scheme) => `${scheme} ${REDACTED}`);

const headers = (input: Headers.Headers, options?: { readonly dropCookies?: boolean }): Headers.Headers => {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(input)) {
		if (options?.dropCookies === true && (name === "set-cookie" || name === "cookie")) continue;
		out[name] = isSensitiveHeader(name) ? REDACTED : value;
	}
	return Headers.fromInput(out);
};

const request = (input: HttpClientRequest.HttpClientRequest): HttpClientRequest.HttpClientRequest =>
	HttpClientRequest.makeWith(
		input.method,
		url(input.url),
		UrlParams.make(
			input.urlParams.params.map(([name, value]): readonly [string, string] => [
				name,
				typeof value !== "string" || UrlParams.isRedactedName(name, SENSITIVE_QUERY_NAMES) ? REDACTED : value,
			]),
		),
		// A fragment can carry an implicit-grant `access_token`; it never reaches
		// the server, so nothing a human debugs is lost by dropping it.
		Option.none(),
		headers(input.headers),
		HttpBody.empty,
	);

const response = (
	input: HttpClientResponse.HttpClientResponse,
	scrubbedRequest: HttpClientRequest.HttpClientRequest = request(input.request),
): HttpClientResponse.HttpClientResponse => {
	const source = new Response(null, { headers: headers(input.headers, { dropCookies: true }) });
	// `Response` refuses a status outside 200–599 at construction; the stand-in
	// reports the original status and the redacted final URL regardless.
	Object.defineProperty(source, "status", { value: input.status });
	Object.defineProperty(source, "url", { value: input.url === "" ? "" : url(input.url) });
	return HttpClientResponse.fromWeb(scrubbedRequest, source);
};

const isResponse = (u: unknown): u is HttpClientResponse.HttpClientResponse =>
	Predicate.hasProperty(u, HttpClientResponse.TypeId);

const REASON_TAGS: ReadonlySet<unknown> = new Set([
	"TransportError",
	"EncodeError",
	"InvalidUrlError",
	"StatusCodeError",
	"DecodeError",
	"EmptyBodyError",
]);

// A bare reason (`error.reason`) kept on its own still holds the live request.
const isReason = (u: unknown): u is HttpClientError.HttpClientErrorReason =>
	Predicate.hasProperty(u, "_tag") &&
	REASON_TAGS.has(u._tag) &&
	Predicate.hasProperty(u, "request") &&
	HttpClientRequest.isHttpClientRequest(u.request);

const MAX_CAUSE_DEPTH = 8;

const foreign = (value: unknown, depth: number): unknown => {
	if (typeof value === "string") return text(value);
	if (value === null || typeof value !== "object") return value;
	if (depth >= MAX_CAUSE_DEPTH) return undefined;
	if (HttpClientError.isHttpClientError(value)) return error(value, depth + 1);
	if (HttpClientRequest.isHttpClientRequest(value)) return request(value);
	if (isResponse(value)) return response(value);
	if (isReason(value)) return reason(value, depth + 1);
	const source = value as Record<string, unknown>;
	// Same prototype, so `instanceof TypeError` still answers as it did.
	const copy: Error =
		value instanceof Error ? Object.create(Object.getPrototypeOf(value)) : new Error(text(safeString(value)));
	if (value instanceof Error) {
		Object.defineProperty(copy, "message", { value: text(value.message), writable: true, configurable: true });
		if (value.name !== Object.getPrototypeOf(value)?.name) copy.name = value.name;
		if (value.stack !== undefined) {
			Object.defineProperty(copy, "stack", { value: text(value.stack), writable: true, configurable: true });
		}
	}
	// Keep the primitive facts a human debugs a transport failure with
	// (`code`, `errno`, `syscall`, `address`, `port`); drop every object.
	for (const [key, field] of Object.entries(source)) {
		if (key === "message" || key === "stack" || key === "cause") continue;
		if (typeof field === "string") (copy as unknown as Record<string, unknown>)[key] = text(field);
		else if (Predicate.isNumber(field) || Predicate.isBoolean(field)) {
			(copy as unknown as Record<string, unknown>)[key] = field;
		}
	}
	if ("cause" in source && source.cause !== undefined) {
		const nested = foreign(source.cause, depth + 1);
		if (nested !== undefined)
			Object.defineProperty(copy, "cause", { value: nested, enumerable: true, writable: true, configurable: true });
	}
	return copy;
};

const safeString = (value: object): string => {
	try {
		return String(value);
	} catch {
		return Object.prototype.toString.call(value);
	}
};

const optional = <K extends string, V>(key: K, value: V | undefined): { readonly [P in K]?: V } =>
	(value === undefined ? {} : { [key]: value }) as { readonly [P in K]?: V };

const reason = (input: HttpClientError.HttpClientErrorReason, depth: number): HttpClientError.HttpClientErrorReason => {
	const scrubbedRequest = request(input.request);
	const cause = foreign(input.cause, depth);
	const base = {
		request: scrubbedRequest,
		...optional("cause", cause),
		...optional("description", input.description === undefined ? undefined : text(input.description)),
	};
	switch (input._tag) {
		case "TransportError":
			return new HttpClientError.TransportError(base);
		case "EncodeError":
			return new HttpClientError.EncodeError(base);
		case "InvalidUrlError":
			return new HttpClientError.InvalidUrlError(base);
		case "StatusCodeError":
			return new HttpClientError.StatusCodeError({ ...base, response: response(input.response, scrubbedRequest) });
		case "DecodeError":
			return new HttpClientError.DecodeError({ ...base, response: response(input.response, scrubbedRequest) });
		case "EmptyBodyError":
			return new HttpClientError.EmptyBodyError({ ...base, response: response(input.response, scrubbedRequest) });
	}
};

const error = (input: HttpClientError.HttpClientError, depth = 0): HttpClientError.HttpClientError =>
	new HttpClientError.HttpClientError({ reason: reason(input.reason, depth) });

/**
 * Credential-free copies of core HTTP client values, for keeping as an error's
 * `cause` or field.
 *
 * @remarks
 * Core's `HttpClientError` keeps the live request — and so its
 * `authorization`, `cookie` and `proxy-authorization` headers — as a plain
 * readable field. Core redacts them only when *rendering* (`toJSON`,
 * inspect); a logger, serializer or consumer that walks the object reads the
 * token. A kit error that keeps an `HttpClientError` (or its request) as
 * `cause` therefore leaks it. Sanitize at the point the cause is kept:
 * `cause: HttpRedaction.cause(cause)`.
 *
 * Every copy keeps what a human debugs with — the method, the URL (userinfo
 * and sensitive query values replaced by `REDACTED`), the status, and the
 * response headers minus `set-cookie` and `cookie` — and drops request and
 * response bodies and the URL fragment. Sensitive header values (`authorization`,
 * `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`,
 * `private-token` and the `x-*-token` / `x-*-api-key` / `x-*-signature`
 * family) read `REDACTED`. Sensitive query parameters are core's own
 * redaction list (the SigV4 presigned set, `Signature`, Azure SAS `sig`)
 * plus `token`, `*_token`, `api_key`, `client_secret`, `secret`, `password`
 * and `code`.
 *
 * A foreign cause nested inside an HTTP error (the `TypeError` a fetch
 * rejects with) is rebuilt on the same prototype — `instanceof` still
 * answers — with its message and stack passed through
 * {@link HttpRedaction.text} and its primitive fields (`code`, `errno`,
 * `syscall`, `port`) kept; object-valued fields are dropped, since nothing
 * can vouch for what they hold.
 *
 * Pure and dependency-free beyond core `effect/http`: no `node:` import, so
 * it runs on Cloudflare Workers.
 *
 * @example
 * ```ts
 * import { HttpRedaction } from "@effected/crypto";
 *
 * console.log(HttpRedaction.url("https://user:pw@registry.test/pkg?token=abc&page=2"));
 * // => "https://REDACTED:REDACTED@registry.test/pkg?token=REDACTED&page=2"
 * ```
 *
 * @public
 */
export class HttpRedaction {
	private constructor() {}

	/**
	 * Whether a header name carries a credential (case-insensitive).
	 */
	static readonly isSensitiveHeader: (name: string) => boolean = isSensitiveHeader;

	/**
	 * A URL with its userinfo and sensitive query (and query-shaped fragment)
	 * values replaced by `REDACTED`; every other character is preserved.
	 */
	static readonly url: (url: string) => string = url;

	/**
	 * Free text with every embedded URL redacted as {@link HttpRedaction.url}
	 * does and every `Bearer`, `Basic` or `token` credential replaced.
	 */
	static readonly text: (text: string) => string = text;

	/**
	 * A copy of a request with sensitive header and query values redacted,
	 * the URL redacted, and the body and fragment dropped.
	 */
	static readonly request: (request: HttpClientRequest.HttpClientRequest) => HttpClientRequest.HttpClientRequest = (
		input,
	) => request(input);

	/**
	 * A body-less copy of a response: its status, its redacted final URL, its
	 * headers minus `set-cookie` and `cookie` with sensitive values redacted,
	 * and a redacted copy of its request.
	 */
	static readonly response: (response: HttpClientResponse.HttpClientResponse) => HttpClientResponse.HttpClientResponse =
		(input) => response(input);

	/**
	 * A copy of an `HttpClientError` whose request, response and nested cause
	 * are all redacted copies. Its `_tag`, reason `_tag`, status and message
	 * shape are unchanged.
	 */
	static readonly error: (error: HttpClientError.HttpClientError) => HttpClientError.HttpClientError = (input) =>
		error(input);

	/**
	 * Sanitize a value about to be kept as a `cause`: an `HttpClientError`,
	 * one of its reasons, a request or a response becomes its redacted copy.
	 * Anything else — a `SchemaError`, a kit error, a plain `Error`, a string
	 * — is returned unchanged, by identity, so the call is safe at a site
	 * whose cause is only sometimes an HTTP value.
	 */
	static readonly cause = (cause: unknown): unknown => {
		if (HttpClientError.isHttpClientError(cause)) return error(cause);
		if (HttpClientRequest.isHttpClientRequest(cause)) return request(cause);
		if (isResponse(cause)) return response(cause);
		if (isReason(cause)) return reason(cause, 0);
		return cause;
	};
}
