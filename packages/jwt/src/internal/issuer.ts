// The one scheme rule for an issuer URL, shared by `JwksResolver` (which
// enforces it) and `TestIssuer` (which refuses to build an issuer the
// resolver would refuse): `https:`, or plain http to the local host only.

/**
 * Whether `issuer` is `http://localhost` or `http://127.0.0.1`.
 *
 * @internal
 */
export const isLocalIssuer = (issuer: string): boolean => {
	try {
		const url = new URL(issuer);
		return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
	} catch {
		return false;
	}
};

/**
 * The protocol of `url`, or `undefined` when it does not parse.
 *
 * @internal
 */
export const protocolOf = (url: string): string | undefined => {
	try {
		return new URL(url).protocol;
	} catch {
		return undefined;
	}
};

/**
 * Whether `issuer` is one `JwksResolver` will discover keys for.
 *
 * @internal
 */
export const isAcceptedIssuer = (issuer: string): boolean => protocolOf(issuer) === "https:" || isLocalIssuer(issuer);
