// Import-free on purpose: the regression test loads this file straight into a
// subprocess with a hard timeout, because an in-process timeout cannot stop a
// synchronous loop that never returns.

/**
 * How many keys one URL yields at most. A credential is configured a few path
 * segments below its host, so the bound only drops the deepest keys of a path
 * with more segments than this, never the host's own key.
 *
 * @internal
 */
export const MAX_NERF_DART_KEYS = 64;

/**
 * The nerf-dart keys npm tries for a URL, deepest first: `//host[:port]/path/`
 * up to `//host[:port]/`, never past the host. `undefined` for a URL that does
 * not parse.
 *
 * @remarks
 * Every prefix of the URL's directory that ends in `/` is one key, so the walk
 * is over the positions of `/` and finishes on any input. An empty path
 * segment is a step of its own: `https://h//pkg/-/x.tgz` yields `//h//pkg/-/`,
 * `//h//pkg/`, `//h//` and `//h/`. That is the trailing-slash subset of what
 * npm-registry-fetch tries: its `regFromURI` strips either the last run of
 * non-slash characters or one `/` per step, so it too stops at `//h//` before
 * `//h/`, and a credential configured for `//h/` is still found.
 *
 * The final segment is dropped unless it ends in `/` (`new URL(".", …)`, which
 * is npm's `toNerfDart`); the host is lowercased and a default port dropped.
 * At most {@link MAX_NERF_DART_KEYS} keys, the shallowest ones.
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
	const directory = new URL(".", `${parsed.protocol}//${parsed.host}${parsed.pathname}`);
	const path = directory.pathname;
	const prefix = `//${directory.host}`;
	// Shallowest first, stopping at the bound, then reversed: an explicit scan
	// of `/` positions, so no step can fail to advance.
	const keys: Array<string> = [];
	let slash = path.indexOf("/");
	while (slash !== -1 && keys.length < MAX_NERF_DART_KEYS) {
		keys.push(prefix + path.slice(0, slash + 1));
		slash = path.indexOf("/", slash + 1);
	}
	return keys.reverse();
};
