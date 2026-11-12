import { Schema } from "effect";

/**
 * An npm transport setting could not be applied, so no HTTP client was built.
 *
 * @remarks
 * Raised while building `NpmHttpClient.layer`, never per request. `setting`
 * names the npmrc key: `"cafile"`, `"certfile"` or `"keyfile"` when that file
 * (top-level `cafile`, or a registry's `//host/:cafile`, `:certfile` or
 * `:keyfile`) could not be read, with `path` naming it as written and the
 * platform failure as `cause`; `"proxy"` when a proxy `NpmConfig.proxyFor`
 * would use does not parse as a URL, or names a scheme other than `http`,
 * `https` or `socks5` (a scheme-less `proxy.corp:8080` under npm's rules).
 *
 * A proxy URL commonly carries a password, so a `"proxy"` failure holds
 * neither the URL nor the parser's error, which repeats its input: the
 * message names the setting only.
 *
 * Files are read when the layer is built, not when a request needs them:
 * every file a setting names for any registry is read, so a missing
 * `//host/:certfile` or `:keyfile` (or, under pnpm rules, `:cafile`) for
 * a registry the program never contacts still fails the whole layer.
 *
 * A missing `cafile` fails here, where both managers carry on without it:
 * npm 12 reads it with a `maybeReadFile` that returns nothing on `ENOENT`
 * (`workspaces/config/lib/definitions/definitions.js`), and pnpm treats a
 * `cafile` it cannot find as unset. Either way the default trust store is
 * used, and a registry signed by the missing CA then fails every read with a
 * TLS error far from the setting that caused it.
 *
 * @public
 */
export class NpmTransportError extends Schema.TaggedError<NpmTransportError>()("NpmTransportError", {
	/** The npmrc setting that could not be applied. */
	setting: Schema.Literals(["cafile", "certfile", "keyfile", "proxy"]),
	/** The file that could not be read, as written in the npmrc, for the file settings. */
	path: Schema.optionalKey(Schema.String),
	/** The underlying failure, for the file settings. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		return this.setting === "proxy"
			? "An npm proxy setting (or proxy environment variable) is not a usable proxy URL (http, https or socks5)"
			: `Could not read the npm ${this.setting} ${this.path ?? "(unknown path)"}`;
	}
}
