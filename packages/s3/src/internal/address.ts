/**
 * Pure addressing and input validation for the S3 client: where a request goes,
 * and whether the caller's input can be sent at all. No IO and no Effect.
 *
 * @internal
 */
import type { S3InvalidRequestReason } from "../S3Error.js";

/**
 * Where the client's requests go, resolved once from its options.
 *
 * @internal
 */
export interface S3Address {
	/** `scheme://host[:port]` the request is sent to. */
	readonly origin: string;
	/** The `host` header value that is signed, port included. */
	readonly host: string;
	/** The endpoint's own path, unencoded, without a trailing `/`; empty for none. */
	readonly basePath: string;
	/** Whether the bucket is the first path segment (true) or a host label (false). */
	readonly pathStyle: boolean;
	/** The bucket name. */
	readonly bucket: string;
}

/**
 * What {@link resolveAddress} reads from the client's options.
 *
 * @internal
 */
export interface S3AddressInput {
	readonly bucket: string;
	readonly region: string;
	readonly endpoint?: string | undefined;
	readonly forcePathStyle?: boolean | undefined;
}

/**
 * A DNS-compatible bucket name, the only kind a host label can carry: 3 to 63
 * lower-case letters, digits, hyphens and single dots, starting and ending with a
 * letter or digit.
 */
const VIRTUAL_HOST_BUCKET = /^(?=.{3,63}$)[a-z0-9](?:[a-z0-9-]|\.(?!\.))*[a-z0-9]$/;

const stripTrailingSlashes = (path: string): string => {
	// A loop, not `/\/+$/`: the anchored regex backtracks quadratically on slash runs.
	let end = path.length;
	while (end > 0 && path.charCodeAt(end - 1) === 47) end--;
	return path.slice(0, end);
};

/**
 * Resolve the client's address from its options.
 *
 * @remarks
 * Throws on a wiring mistake (an empty region or bucket, a bucket holding `/`, an
 * endpoint that is not an `http:` or `https:` URL or carries a query, fragment or
 * credentials, or a bucket a host label cannot carry); the caller turns the throw
 * into a defect at construction. With `forcePathStyle` unset, a bucket name holding
 * a dot is addressed path style over `https`, since a wildcard certificate cannot
 * cover it as a host label; an explicit `forcePathStyle: false` is honoured. The URL parser has already collapsed any `.` or
 * `..` segment of the endpoint's path, `%2e` spellings included, so the base path
 * signed is the one sent.
 *
 * @internal
 */
export const resolveAddress = (input: S3AddressInput): S3Address => {
	if (input.region.trim() === "") throw new Error("S3Client: region must not be empty");
	const bucket = input.bucket;
	if (bucket === "" || bucket === "." || bucket === ".." || bucket.includes("/")) {
		throw new Error(`S3Client: bucket ${JSON.stringify(bucket)} is not a bucket name`);
	}
	const raw = input.endpoint ?? `https://s3.${input.region}.amazonaws.com`;
	let url: URL;
	try {
		url = new URL(raw);
	} catch (cause) {
		throw new Error(`S3Client: endpoint ${JSON.stringify(raw)} is not a URL`, { cause });
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error(`S3Client: endpoint ${JSON.stringify(raw)} must be an http: or https: URL`);
	}
	if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
		throw new Error(`S3Client: endpoint ${JSON.stringify(raw)} must carry no query, fragment or credentials`);
	}
	let basePath: string;
	try {
		basePath = stripTrailingSlashes(decodeURIComponent(url.pathname));
	} catch (cause) {
		throw new Error(`S3Client: endpoint ${JSON.stringify(raw)} has an undecodable path`, { cause });
	}
	// A dotted bucket as a host label (`my.bucket.s3.<region>.amazonaws.com`)
	// does not match a `*.s3.<region>.amazonaws.com` wildcard certificate, so over
	// `https` it fails TLS at the first request: default it to path style.
	const pathStyle =
		input.forcePathStyle ?? (input.endpoint !== undefined || (url.protocol === "https:" && bucket.includes(".")));
	if (!pathStyle && !VIRTUAL_HOST_BUCKET.test(bucket)) {
		throw new Error(
			`S3Client: bucket ${JSON.stringify(bucket)} cannot be addressed as a host label; set forcePathStyle: true`,
		);
	}
	const host = pathStyle ? url.host : `${bucket}.${url.host}`;
	return { origin: `${url.protocol}//${host}`, host, basePath, pathStyle, bucket };
};

/**
 * The unencoded path of one object, as SigV4 signs it.
 *
 * @internal
 */
export const objectPath = (address: S3Address, key: string): string =>
	address.pathStyle ? `${address.basePath}/${address.bucket}/${key}` : `${address.basePath}/${key}`;

/**
 * The unencoded path of the bucket itself, which a listing is sent to.
 *
 * @internal
 */
export const bucketPath = (address: S3Address): string =>
	address.pathStyle ? `${address.basePath}/${address.bucket}` : `${address.basePath}/`;

const encoder = new TextEncoder();

/** S3's documented key limit, in UTF-8 bytes. */
const MAX_KEY_BYTES = 1024;

/**
 * Why a key cannot be sent, or `undefined` when it can.
 *
 * @remarks
 * Empty, longer than 1024 UTF-8 bytes, or holding a segment that is exactly `.` or
 * `..`: every URL parser collapses such a segment, so the store would receive
 * another key than the one signed.
 *
 * @internal
 */
export const keyProblem = (key: string): S3InvalidRequestReason | undefined =>
	key === ""
		? "empty-key"
		: encoder.encode(key).byteLength > MAX_KEY_BYTES
			? "key-too-long"
			: key.split("/").some((segment) => segment === "." || segment === "..")
				? "dot-segment"
				: undefined;

/** An HTTP token (RFC 9110 `tchar`), the only shape a header name may take. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Whether a metadata name can follow `x-amz-meta-` in a header name.
 *
 * @internal
 */
export const isToken = (name: string): boolean => TOKEN.test(name);

/**
 * Whether a header value is printable US-ASCII (with tab).
 *
 * @remarks
 * S3 requires US-ASCII metadata values, and a WebAPI `Headers` throws on a value
 * with a line break or a code point above U+00FF, so anything outside printable
 * ASCII is refused before it can become a defect.
 *
 * @internal
 */
export const isHeaderValue = (value: string): boolean => {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code !== 9 && (code < 0x20 || code > 0x7e)) return false;
	}
	return true;
};

/**
 * Whether `maxKeys` is a page size ListObjectsV2 accepts: an integer from 1 to 1000.
 *
 * @internal
 */
export const isMaxKeys = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= 1000;
