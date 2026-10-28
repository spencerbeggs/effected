// Import-free on purpose: the regression test loads this file straight into a
// subprocess with a hard timeout, because an in-process timeout cannot stop a
// synchronous loop that never returns.

/**
 * How many keys one URL yields at most. A credential is configured a few path
 * segments below its host, so the bound only drops the deepest keys of a path
 * with more segments than this, never the host's own keys.
 *
 * @internal
 */
export const MAX_NERF_DART_KEYS = 64;

/**
 * The nerf-dart keys npm tries for a URL, deepest first, never past the host.
 * `undefined` for a URL that does not parse.
 *
 * @remarks
 * The order is npm-registry-fetch 19.1.1's `regFromURI` (`lib/auth.js`, the
 * walk behind `getAuth`). It starts at `//host[:port]` plus the URL's whole
 * path and, one step at a time, strips either the trailing run of non-slash
 * characters or one trailing `/`, stopping before `//`. So every level is
 * tried with its trailing slash and then without it, and the request's own
 * path is the first key: `https://h/a/b.tgz` yields `//h/a/b.tgz`, `//h/a/`,
 * `//h/a`, `//h/` and `//h`. When `//h/a/` and `//h/a` are both configured,
 * the slash form wins, because it comes first; a deeper slash-less key still
 * beats a shallower slash key. A port is part of the host (`//h:8443/` then
 * `//h:8443`), and `@npmcli/config` does not rewrite either spelling when it
 * reads an npmrc, so both reach this lookup as written.
 *
 * Every key is a prefix of the request's own `//host[:port]/path` that ends
 * on a segment boundary, so no key can widen the match: `//h` never matches
 * `//hevil.com`, and `//h/pa` never matches `/path/`.
 *
 * This builds the same list without stripping: it scans the positions of `/`
 * in the path once, so it finishes on any input. An empty path segment is a
 * level of its own, as in npm: `https://h//pkg/x.tgz` yields `//h//pkg/x.tgz`,
 * `//h//pkg/`, `//h//pkg`, `//h//`, `//h/` and `//h`, so a credential
 * configured for `//h/` is still found.
 *
 * The host is lowercased and a default port dropped, as `URL` does; the query
 * and fragment are not part of any key. At most {@link MAX_NERF_DART_KEYS}
 * keys, the shallowest ones.
 *
 * @internal
 */
export const nerfDartKeys = (url: string): ReadonlyArray<string> | undefined => {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	const prefix = `//${parsed.host}`;
	const whole = prefix + parsed.pathname;
	// Shallowest first, stopping at the bound, then reversed.
	const keys: Array<string> = [];
	const take = (end: number): void => {
		const key = whole.slice(0, end);
		// npm stops at `//`; a cut just before a `/` that follows another `/`
		// is the previous level's slash form, already taken.
		if (end > "//".length && keys.length < MAX_NERF_DART_KEYS && keys.at(-1) !== key) keys.push(key);
	};
	// The path's leading `/` sits at `prefix.length`, so its slash-less cut is
	// the host alone, `//host[:port]`.
	let slash = whole.indexOf("/", prefix.length);
	while (slash !== -1 && keys.length < MAX_NERF_DART_KEYS) {
		take(slash);
		take(slash + 1);
		slash = whole.indexOf("/", slash + 1);
	}
	take(whole.length);
	return keys.reverse();
};
