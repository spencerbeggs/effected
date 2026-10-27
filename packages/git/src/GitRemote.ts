// A pure parser for git remote addresses: the forms git itself accepts for a
// remote (`git clone`, `remote.<name>.url`, a `.gitmodules` url), split into
// VERBATIM parts.
//
// Nothing is normalized. No lowercasing, no `.git` stripping, no trailing-slash
// trimming, no percent-decoding, no shorthand expansion (`github:o/n` is git's
// scp form with host `github`, exactly as git reads it). A caller that needs a
// canonical key composes one from the parts; the parts reproduce the input
// (see `GitRemote.format`), with one exception: a URL's password is never
// retained.
//
// The classification follows git, probed against git 2.56 with a recording
// GIT_SSH_COMMAND and a stub remote helper:
//
//   1. `<transport>::<address>` first (transport.c transport_get): a run of
//      scheme characters, `[A-Za-z0-9][A-Za-z0-9+.-]*`, then `::`. The remote
//      helper receives everything after that first `::`.
//   2. Any `://` makes a URL (connect.c parse_connect_url: `strstr(url,
//      "://")`); the text before it is the scheme, whatever it is.
//   3. Otherwise git's url_is_local_not_ssh: no `:`, or a `/` before the first
//      `:`, is a local path. A plain strchr, with no bracket skipping.
//   4. Otherwise the scp form, whose host ends at the first `:` after
//      host_end's bracket rule (a leading `[...]`, or one right after `@[`).
//
// The parser is total and linear: index scans only, no regex, no recursion.

import { Option, Schema } from "effect";
import { REDACTED, maskUserinfoAnywhere } from "./internal/redact.js";

/**
 * A remote in URL form: `<scheme>://[<user>[:<password>]@]<host>[:<port>]<path>`
 * (`https://github.com/o/n.git`, `ssh://git@host:22/o/n`, `file:///srv/r.git`).
 *
 * @remarks
 * The userinfo ends at the LAST `@` after `://`, wherever it falls. That is
 * stricter than git's own credential parser, which splits at the first `@`
 * inside the first `/?#`-bounded span — so an unencoded password containing
 * `@`, `/`, `?` or `#` would leak part of itself into git's host or path. Here
 * such a password is consumed whole and dropped. The cost, accepted by design:
 * an `@` in a URL path or query is read as the end of userinfo, so the text
 * before it becomes `user` and the host is lost — `https://h/pkg@1.0/r.git`
 * parses as user `h/pkg`, host `1.0`, and redacts to
 * `https://<redacted>@1.0/r.git`. Such paths are rare in git remotes.
 *
 * @public
 */
export class GitRemoteUrl extends Schema.TaggedClass<GitRemoteUrl>()("GitRemoteUrl", {
	/**
	 * The text before `://`, as written: `https`, `git+ssh`, `HTTPS`. git
	 * accepts any `://`-bearing address as a URL and rejects an unknown scheme
	 * only when it connects, so this is not validated.
	 */
	scheme: Schema.String,
	/**
	 * The userinfo before its first `:`, verbatim. A token used as the user
	 * (`https://ghp_x@github.com/...`) is kept here; mask it with
	 * {@link GitRemote.redact} before logging.
	 */
	user: Schema.optionalKey(Schema.String),
	/**
	 * The host as written, case included. An IPv6 literal keeps its brackets
	 * (`[::1]`). Empty for `file:///path`.
	 */
	host: Schema.String,
	/** The port as written (unvalidated). */
	port: Schema.optionalKey(Schema.String),
	/**
	 * Everything after the host and port, verbatim: from the first `/`, `?` or
	 * `#` on, including any `.git` suffix, trailing `/`, query and fragment.
	 * Empty when the URL ends at the host.
	 */
	path: Schema.String,
}) {}

/**
 * A remote in git's scp-like form: `[<user>@]<host>:<path>`
 * (`git@github.com:o/n.git`). Git reads an address as this form when a `:`
 * comes before any `/`.
 *
 * @remarks
 * The rule is git's own on POSIX, applied on every platform: a Windows drive
 * path such as `C:/repo` is this form, with host `C`. The host ends at the
 * first `:` after git's bracket rule, so `[::1]:o/n` has host `[::1]` and
 * `git@[::1]:o/n` has user `git`; the brackets are kept verbatim. `user` is
 * split at the LAST `@`, as ssh splits `user@host`.
 *
 * The scp form has no password syntax. git reads `u:s3cret@host:repo` as host
 * `u` and path `s3cret@host:repo` (probed: it sends that path to ssh host
 * `u`), so this parser does too, and that text is in `path`.
 *
 * @public
 */
export class GitRemoteScp extends Schema.TaggedClass<GitRemoteScp>()("GitRemoteScp", {
	/** The text before the last `@` of the host part, when there is one. */
	user: Schema.optionalKey(Schema.String),
	/** The host as written, brackets and case included. May be empty (`:path`). */
	host: Schema.String,
	/** Everything after the separating `:`, verbatim. May be empty. */
	path: Schema.String,
}) {}

/**
 * A remote that is a filesystem path: no `:`, or a `/` before the first `:`
 * (`/srv/repo.git`, `../sibling.git`, `./a:b`, `owner/name`).
 *
 * @public
 */
export class GitRemotePath extends Schema.TaggedClass<GitRemotePath>()("GitRemotePath", {
	/** The path as written. */
	path: Schema.String,
}) {}

/**
 * A remote routed through a named remote helper: `<transport>::<address>`
 * (`persistent::https://host/r`, `ext::ssh host %S`). git runs
 * `git-remote-<transport>` and hands it `address`.
 *
 * @remarks
 * `address` is parsed once more as a URL, scp or path form (never as a second
 * transport: `a::b::c` is transport `a` over the scp address `b::c`), so a
 * password inside it is dropped like any other.
 *
 * @public
 */
export class GitRemoteTransport extends Schema.TaggedClass<GitRemoteTransport>()("GitRemoteTransport", {
	/** The helper name before `::`, as written. */
	transport: Schema.String,
	/** The address handed to the helper. */
	address: Schema.Union([GitRemoteUrl, GitRemoteScp, GitRemotePath]),
}) {}

/**
 * A parsed git remote address.
 *
 * @public
 */
export type GitRemoteForm = GitRemoteUrl | GitRemoteScp | GitRemotePath | GitRemoteTransport;

/** git's is_urlschemechar: alphanumeric, plus `+`, `-` and `.` after the first character. */
const isSchemeChar = (char: string, first: boolean): boolean =>
	(char >= "a" && char <= "z") ||
	(char >= "A" && char <= "Z") ||
	(char >= "0" && char <= "9") ||
	(!first && (char === "+" || char === "-" || char === "."));

/** The length of the leading run of scheme characters. */
const schemeRunLength = (raw: string): number => {
	let index = 0;
	while (index < raw.length && isSchemeChar(raw[index] ?? "", index === 0)) index++;
	return index;
};

/** The index of the first `/`, `?` or `#` in `text`, or `text.length`. */
const authorityEnd = (text: string): number => {
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (char === "/" || char === "?" || char === "#") return index;
	}
	return text.length;
};

/** Splits `host[:port]`; a bracketed IPv6 host ends at its `]`. */
const splitHostPort = (hostport: string): { readonly host: string; readonly port: string | undefined } => {
	if (hostport.startsWith("[")) {
		const close = hostport.indexOf("]");
		if (close !== -1 && (close === hostport.length - 1 || hostport[close + 1] === ":")) {
			const host = hostport.slice(0, close + 1);
			return close === hostport.length - 1 ? { host, port: undefined } : { host, port: hostport.slice(close + 2) };
		}
		// An unclosed or trailing-junk bracket is not an IPv6 literal: keep it whole.
		return { host: hostport, port: undefined };
	}
	const colon = hostport.indexOf(":");
	return colon === -1
		? { host: hostport, port: undefined }
		: { host: hostport.slice(0, colon), port: hostport.slice(colon + 1) };
};

const parseUrl = (scheme: string, rest: string): GitRemoteUrl => {
	// Userinfo runs to the LAST `@`: a password may hold `@`, `/`, `?` or `#`,
	// and none of it may survive outside the dropped password.
	const at = rest.lastIndexOf("@");
	const userinfo = at === -1 ? undefined : rest.slice(0, at);
	const afterUserinfo = at === -1 ? rest : rest.slice(at + 1);
	const end = authorityEnd(afterUserinfo);
	const { host, port } = splitHostPort(afterUserinfo.slice(0, end));
	const colon = userinfo === undefined ? -1 : userinfo.indexOf(":");
	const user = userinfo === undefined ? undefined : colon === -1 ? userinfo : userinfo.slice(0, colon);
	return GitRemoteUrl.make({
		scheme,
		host,
		path: afterUserinfo.slice(end),
		...(user !== undefined && { user }),
		...(port !== undefined && { port }),
	});
};

/**
 * git's host_end: the index the scp host-separator search starts from. A
 * bracket at the start, or right after the first `@[`, extends the host to its
 * closing `]`; anything else starts at 0.
 */
const hostEnd = (raw: string): number => {
	const atBracket = raw.indexOf("@[");
	const start = atBracket === -1 ? 0 : atBracket + 1;
	if (raw[start] !== "[") return 0;
	const close = raw.indexOf("]", start + 1);
	return close === -1 ? 0 : close;
};

/** Parses an address that is not a transport form: URL, scp or path. Total. */
const parseAddress = (raw: string): GitRemoteUrl | GitRemoteScp | GitRemotePath => {
	const separator = raw.indexOf("://");
	if (separator !== -1) return parseUrl(raw.slice(0, separator), raw.slice(separator + 3));
	const colon = raw.indexOf(":");
	const slash = raw.indexOf("/");
	if (colon === -1 || (slash !== -1 && slash < colon)) return GitRemotePath.make({ path: raw });
	// git dies ("no path specified") when no `:` follows the bracketed host;
	// this parser falls back to the first `:`, which classification found.
	const afterBrackets = raw.indexOf(":", hostEnd(raw));
	const sep = afterBrackets === -1 ? colon : afterBrackets;
	const hostPart = raw.slice(0, sep);
	const at = hostPart.lastIndexOf("@");
	return GitRemoteScp.make({
		host: at === -1 ? hostPart : hostPart.slice(at + 1),
		path: raw.slice(sep + 1),
		...(at !== -1 && { user: hostPart.slice(0, at) }),
	});
};

const formatAddress = (remote: GitRemoteUrl | GitRemoteScp | GitRemotePath): string => {
	switch (remote._tag) {
		case "GitRemoteUrl":
			return `${remote.scheme}://${remote.user !== undefined ? `${remote.user}@` : ""}${remote.host}${
				remote.port !== undefined ? `:${remote.port}` : ""
			}${remote.path}`;
		case "GitRemoteScp":
			return `${remote.user !== undefined ? `${remote.user}@` : ""}${remote.host}:${remote.path}`;
		case "GitRemotePath":
			return remote.path;
	}
};

/** RFC 3986's scheme grammar. A URL form's `scheme` outside it is text git rejects, and may hold anything. */
const isValidScheme = (scheme: string): boolean => {
	if (scheme === "") return false;
	const first = scheme[0] ?? "";
	if (!((first >= "a" && first <= "z") || (first >= "A" && first <= "Z"))) return false;
	for (let index = 1; index < scheme.length; index++) {
		if (!isSchemeChar(scheme[index] ?? "", false)) return false;
	}
	return true;
};

/**
 * Redacts a non-URL address as ONE string, then re-parses it. Whatever could be
 * userinfo before the last `@` is masked wherever the parse put it — an scp
 * path, an scp host (`[:s3cret]:@`), a path form — and the re-parsed scp user,
 * if any, is masked too. `separated` is set for a transport's address, whose
 * `::` consumed the `:` that bounds a mistyped userinfo (`https::tok@h`): the
 * address is masked as if that `:` were still in front of it.
 *
 * The mask inserts no `://`, so the re-parse cannot turn a non-URL into a URL;
 * the URL arm is defensive.
 */
const redactAsString = (text: string, separated: boolean): GitRemoteUrl | GitRemoteScp | GitRemotePath => {
	const masked = separated ? maskUserinfoAnywhere(`:${text}`).slice(1) : maskUserinfoAnywhere(text);
	const form = parseAddress(masked);
	if (form._tag === "GitRemoteUrl") return redactAddress(form, separated);
	if (form._tag === "GitRemoteScp" && form.user !== undefined) {
		return GitRemoteScp.make({ user: REDACTED, host: form.host, path: form.path });
	}
	return form;
};

/**
 * The URL schemes a transport's address keeps when redacted. After `<transport>::`
 * the scheme is free text git hands to a helper, so `https::S3CRET://@` reads as
 * a token between two colons; only a scheme from this list is known not to be one.
 */
const KNOWN_URL_SCHEMES: ReadonlySet<string> = new Set([
	"http",
	"https",
	"ssh",
	"git",
	"file",
	"ftp",
	"ftps",
	"rsync",
	"svn",
	"git+ssh",
	"ssh+git",
	"git+https",
	"git+http",
	"git+file",
	"svn+ssh",
]);

const redactAddress = (
	remote: GitRemoteUrl | GitRemoteScp | GitRemotePath,
	inTransport = false,
): GitRemoteUrl | GitRemoteScp | GitRemotePath => {
	switch (remote._tag) {
		case "GitRemoteUrl": {
			const query = remote.path.indexOf("?");
			const path = query === -1 ? remote.path : `${remote.path.slice(0, query + 1)}${REDACTED}`;
			return GitRemoteUrl.make({
				scheme:
					isValidScheme(remote.scheme) && (!inTransport || KNOWN_URL_SCHEMES.has(remote.scheme.toLowerCase()))
						? remote.scheme
						: REDACTED,
				host: remote.host,
				path,
				...(remote.user !== undefined && { user: REDACTED }),
				...(remote.port !== undefined && { port: remote.port }),
			});
		}
		case "GitRemoteScp":
		case "GitRemotePath":
			return redactAsString(formatAddress(remote), false);
	}
};

/**
 * Git remote addresses: parse into verbatim parts, render back, redact for
 * logging.
 *
 * @remarks
 * The credential contract is exact: **a URL's password is never retained**,
 * in any form (a transport form's address included). Credentials in other
 * positions ARE retained, because the parts are verbatim: a token used as the
 * URL user, a token in a query string, and anything git itself reads as an
 * scp path. Pass a parsed remote through {@link GitRemote.redact} before
 * logging or annotating it.
 *
 * For any input whose URL userinfo carries no password,
 * `GitRemote.format(parse(raw))` is `raw` again.
 *
 * @example
 * ```ts
 * import { GitRemote } from "@effected/git";
 * import { Option } from "effect";
 *
 * const remote = GitRemote.parse("git@github.com:effected/kit.git");
 * // Option.some(GitRemoteScp { user: "git", host: "github.com", path: "effected/kit.git" })
 * const path = Option.map(remote, GitRemote.repositoryPath); // Option.some("effected/kit")
 * ```
 *
 * @public
 */
export class GitRemote {
	private constructor() {}

	/**
	 * Parses a remote address into its form and verbatim parts.
	 *
	 * @remarks
	 * Total: `Option.none` only for a blank string. The input is not trimmed —
	 * `Git.remoteUrl` already trims, and a path may carry surrounding
	 * whitespace. Classification follows git: `<transport>::` first, then any
	 * `://` (a URL), then a `:` before any `/` (the scp form, so `github:o/n`
	 * is scp with host `github` and `C:/repo` is scp with host `C`), else a
	 * path.
	 */
	static parse(raw: string): Option.Option<GitRemoteForm> {
		if (raw.trim() === "") return Option.none();
		const run = schemeRunLength(raw);
		if (run > 0 && raw.startsWith("::", run)) {
			return Option.some(
				GitRemoteTransport.make({ transport: raw.slice(0, run), address: parseAddress(raw.slice(run + 2)) }),
			);
		}
		return Option.some(parseAddress(raw));
	}

	/**
	 * Renders a parsed remote back to an address. The inverse of
	 * {@link GitRemote.parse}, except that a URL's password is gone.
	 */
	static format(remote: GitRemoteForm): string {
		return remote._tag === "GitRemoteTransport"
			? `${remote.transport}::${formatAddress(remote.address)}`
			: formatAddress(remote);
	}

	/**
	 * The remote with every position that can hold a credential masked, for
	 * logging. Each of these becomes `<redacted>`:
	 *
	 * - a URL's or scp form's `user`;
	 * - a URL's query, from `?` to the end of the path, fragment included;
	 * - a URL `scheme` outside RFC 3986's grammar
	 *   (`[A-Za-z][A-Za-z0-9+.-]*`): text before a late `://`, such as the
	 *   `u:pw@h` of `u:pw@h://x`, which git rejects as a protocol anyway;
	 * - in an scp or path form, whatever could be userinfo before the LAST
	 *   `@` — from the first `//` run, or from the first `:` and the `:`/`/`
	 *   run after it — wherever the parse put it: the scp path of git's
	 *   reading of `u:s3cret@host:repo` (becomes `u:<redacted>@host:repo`), a
	 *   bracketed scp host, or a path. The redacted text is re-parsed, so the
	 *   result's form can differ from the input's. This also masks a mistyped
	 *   credential URL that does not parse as a URL: `https:://u:tok@h/r`,
	 *   `https:/u:tok@h/r`, `//u:tok@h/r`;
	 * - a transport's URL scheme unless it is a well-known one (`https`, `ssh`,
	 *   `git+ssh`, ...), since after `::` it is free text (`https::S3CRET://@`);
	 * - a transport's non-URL address the same way, its `::` standing in for
	 *   the `:` (`https::tok@h` becomes `https::<redacted>@h`).
	 *
	 * @remarks
	 * Conservative by design: the last three rules over-mask a legitimate scheme
	 * or scp path of those shapes. They change only what is logged; `parse`
	 * stays faithful to git. Valid
	 * schemes, hosts and ports are kept, so the redacted form still says where
	 * the remote is.
	 */
	static redact(remote: GitRemoteForm): GitRemoteForm {
		if (remote._tag !== "GitRemoteTransport") return redactAddress(remote);
		const address =
			remote.address._tag === "GitRemoteUrl"
				? redactAddress(remote.address, true)
				: redactAsString(formatAddress(remote.address), true);
		return GitRemoteTransport.make({ transport: remote.transport, address });
	}

	/**
	 * The repository path a remote names: the path with, in order, a URL's
	 * leading `/`, one trailing `/` and one trailing `.git` removed. `o/n` for
	 * both `https://github.com/o/n.git/` and `git@host:o/n.git`; a path-form
	 * remote keeps its leading `/` (`/srv/r.git` gives `/srv/r`). A transport
	 * form answers for its address.
	 *
	 * @remarks
	 * A convenience for display and matching. It is NOT a canonical key — case
	 * is untouched and the host is not included.
	 */
	static repositoryPath(remote: GitRemoteForm): string {
		const address = remote._tag === "GitRemoteTransport" ? remote.address : remote;
		let path = address.path;
		if (address._tag === "GitRemoteUrl" && path.startsWith("/")) path = path.slice(1);
		if (path.endsWith("/")) path = path.slice(0, -1);
		if (path.endsWith(".git")) path = path.slice(0, -4);
		return path;
	}
}
