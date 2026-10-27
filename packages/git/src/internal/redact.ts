// The form-independent credential mask shared by `GitRemote.redact` and
// `GitCommand`'s argv redaction. Internal: not part of the package surface.

/**
 * The mask every redacted credential position is replaced with. It is
 * `<redacted>`, git's own placeholder style in its messages, and deliberately
 * not the `***` of `@effected/commands`' Redaction: git takes no dependency on it.
 */
export const REDACTED = "<redacted>";

/**
 * The form-independent backstop: masks whatever could be userinfo before the
 * LAST `@`, starting at the earlier of (a) just past the first `//` run or (b)
 * just past the first `:` and any `:`/`/` run after it. Covers what parses as
 * no URL at all — the typo'd `https:://u:tok@h/r` (transport `https` over a
 * path), `https:/u:tok@h/r` (scp) and `//u:tok@h/r` (a path), each of which git
 * echoes to stderr. A value whose only `@` precedes every `:` and `//` — the
 * scp user of `git@github.com:o/n` — is untouched. Over-masks by design: an
 * `@` later in a path pulls the text before it into the mask.
 */
export const maskUserinfoAnywhere = (value: string): string => {
	const span = userinfoSpan(value);
	return span === undefined ? value : `${value.slice(0, span.start)}${REDACTED}${value.slice(span.end)}`;
};

/** The `[start, end)` span {@link maskUserinfoAnywhere} masks, or `undefined` when it masks nothing. */
const userinfoSpan = (value: string): { readonly start: number; readonly end: number } | undefined => {
	const at = value.lastIndexOf("@");
	if (at === -1) return undefined;
	const skipRun = (from: number): number => {
		let index = from;
		while (value[index] === ":" || value[index] === "/") index++;
		return index;
	};
	const slashes = value.indexOf("//");
	const colon = value.indexOf(":");
	const starts = [slashes === -1 ? -1 : skipRun(slashes), colon === -1 ? -1 : skipRun(colon + 1)].filter(
		(index) => index !== -1 && index <= at,
	);
	return starts.length === 0 ? undefined : { start: Math.min(...starts), end: at };
};

/**
 * Exact-string secrets shorter than this are not masked by exact string: a
 * one- or two-character mask would garble every occurrence in git's stderr
 * while protecting nothing. The shape-based masker still applies to them.
 */
export const MIN_SECRET_LENGTH = 3;

/**
 * The credential text a sensitive URL positional carries, for exact-string
 * masking of git's output: the backstop's userinfo span, the userinfo after a
 * `://` (to the last `@`), and the password part of each (after its first
 * `:`). Unlike the shape masker, these match whatever characters the secret
 * holds — a quote, a space, a tab.
 */
export const credentialSegments = (value: string): ReadonlyArray<string> => {
	const at = value.lastIndexOf("@");
	if (at === -1) return [];
	const userinfos: Array<string> = [];
	const span = userinfoSpan(value);
	if (span !== undefined) userinfos.push(value.slice(span.start, span.end));
	const separator = value.indexOf("://");
	if (separator !== -1 && separator + 3 <= at) userinfos.push(value.slice(separator + 3, at));
	const segments = new Set<string>();
	for (const userinfo of userinfos) {
		segments.add(userinfo);
		const colon = userinfo.indexOf(":");
		if (colon !== -1) segments.add(userinfo.slice(colon + 1));
	}
	return [...segments].filter((segment) => segment.length >= MIN_SECRET_LENGTH && segment !== REDACTED);
};

/**
 * Replaces every occurrence of each known secret in `text`, longest first so
 * a password inside a longer userinfo cannot leave the user half behind.
 */
export const maskSecrets = (text: string, secrets: ReadonlyArray<string>): string => {
	let masked = text;
	for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
		if (secret.length >= MIN_SECRET_LENGTH) masked = masked.split(secret).join(REDACTED);
	}
	return masked;
};

/**
 * Applies {@link maskUserinfoAnywhere} to every whitespace- or quote-delimited
 * token of free text — git's stderr, which echoes a remote it could not use
 * (`fatal: credential url cannot be parsed: //u:tok@github.com/o/r/`,
 * `fatal: '//u:tok@h/r' does not appear to be a git repository`). Tokens with
 * no `@`, and `git@github.com:`-shaped ones whose `@` precedes every `:`, are
 * untouched, so ordinary diagnostics stay readable. Linear: one character-class
 * scan plus a linear mask per token.
 */
export const maskCredentialsInText = (text: string): string =>
	text.includes("@") ? text.replace(/[^\s'"`]+/g, (token) => maskUserinfoAnywhere(token)) : text;
