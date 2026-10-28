import { Option } from "effect";

/**
 * Which path syntax {@link LspUri} reads and writes: `"posix"` (`/home/a`)
 * or `"win32"` (`C:\Users\a`, `\\server\share\a`).
 *
 * @remarks
 * Always passed explicitly, never read from the running process, so the
 * conversion is pure and a worker or a test can convert either platform's
 * paths anywhere. A server picks it once at its edge, typically from
 * `process.platform === "win32"`.
 *
 * @public
 */
export type LspUriPlatform = "posix" | "win32";

/**
 * Options for {@link LspUri.toPath} and {@link LspUri.fromPath}.
 *
 * @public
 */
export interface LspUriOptions {
	/** The path syntax to read or write. Defaults to `"posix"`. */
	readonly platform?: LspUriPlatform;
}

// RFC 3986 `scheme ":"` for `file`, case-insensitively (RFC 3986 §3.1).
const FILE_SCHEME = /^file:/i;
// A Windows drive segment: a letter, then `:` (or RFC 8089 Appendix E.2.2's
// legacy `|`).
const DRIVE = /^[A-Za-z][:|]$/;
const DRIVE_PATH = /^[A-Za-z]:(?:\/|$)/;
// A host as `toPath` reads it and `fromPath` writes it: dot-separated labels
// of ASCII letters, digits, `-` and `_`, never percent-encoded. That rules out
// every host that turns a UNC root into something else: `.` and `?` (the
// Win32 device and namespace roots `\\.\` and `\\?\`), a separator, `%`,
// NUL, userinfo, a port, an IPv6 literal and an empty label.
const HOSTNAME = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
// The sub-delims and marks `encodeURIComponent` leaves alone but `vscode-uri`
// encodes; encoding them too keeps a path's URI identical across both.
const EXTRA = /[!'()*]/g;

/**
 * Remove `.` and `..` segments (RFC 3986 §5.2.4) from the segments after a
 * root, never climbing above it. A `.` or `..` in the last position leaves an
 * empty segment behind, so the result keeps its trailing slash.
 */
const removeDotSegments = (segments: ReadonlyArray<string>): Array<string> => {
	const out: Array<string> = [];
	segments.forEach((segment, index) => {
		const last = index === segments.length - 1;
		if (segment === ".") {
			if (last) out.push("");
		} else if (segment === "..") {
			out.pop();
			if (last) out.push("");
		} else {
			out.push(segment);
		}
	});
	return out;
};

/**
 * Percent-encode one path segment or host: every character except RFC 3986's
 * unreserved set (`A-Z a-z 0-9 - . _ ~`) becomes its UTF-8 bytes as `%XX`,
 * uppercase. A lone surrogate has no UTF-8 encoding, so it throws.
 */
const encode = (segment: string): string => {
	try {
		return encodeURIComponent(segment).replace(EXTRA, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
	} catch {
		throw new TypeError(`LspUri.fromPath: ${JSON.stringify(segment)} holds a lone surrogate, which no URI can encode`);
	}
};

/** Percent-decode one segment, or `undefined` for a malformed escape or invalid UTF-8. */
const decode = (segment: string): string | undefined => {
	try {
		return decodeURIComponent(segment);
	} catch {
		return undefined;
	}
};

// A segment naming a DOS device: `@effected/walker`'s set exactly (`CON`,
// `PRN`, `AUX`, `NUL`, `COM0`-`COM9`, `LPT0`-`LPT9`, the superscript-digit
// `COM`/`LPT` variants, `CONIN$`, `CONOUT$`), in any case, with trailing
// spaces and with or without an extension (`nul.txt`, `con .txt`).
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9\xb9\xb2\xb3]|lpt[0-9\xb9\xb2\xb3]|conin\$|conout\$) *(?:\..*)?$/i;

/**
 * Why win32 would not open a segment as the entry it spells, or `undefined`:
 * a `:` (an NTFS alternate data stream, `b:stream`), a trailing dot or space
 * (which win32 trims, so `a.` opens `a`), or a DOS device name.
 */
const segmentRefusal = (segment: string): string | undefined => {
	if (segment.includes(":")) {
		return `has a segment ${JSON.stringify(segment)} holding a ':', which win32 reads as an alternate data stream`;
	}
	if (segment.endsWith(".") || segment.endsWith(" ")) {
		return `has a segment ${JSON.stringify(segment)} ending in a dot or a space, which win32 trims away`;
	}
	if (DEVICE_NAME.test(segment)) return `has a segment ${JSON.stringify(segment)} that names a DOS device`;
	return undefined;
};

/**
 * Why `fromPath` refuses a Win32 path, or `undefined` when it accepts it.
 * The one statement of the refused set: `fromPath` throws on a reason, and
 * `toPath` answers `Option.none()` for any path this refuses, so `toPath`
 * never answers a path `fromPath` would not write. Segments are checked
 * after `.` and `..` are removed, as both directions remove them.
 */
const win32Refusal = (path: string): string | undefined => {
	if (path.includes("\0")) return "holds a NUL character";
	const slashed = path.replaceAll("\\", "/");
	// `\\?\`, `\\.\` and the NT object-manager prefix `\??\`.
	if (slashed.startsWith("//?/") || slashed.startsWith("//./") || slashed.startsWith("/??/")) {
		return "is a Win32 device or namespace path, which no file: URI names";
	}
	let segments: ReadonlyArray<string>;
	if (slashed.startsWith("//")) {
		const [server = "", share = "", ...rest] = slashed.slice(2).split("/");
		if (!HOSTNAME.test(server)) return "is not a UNC path whose server is a hostname";
		if (share === "" || share === "." || share === "..") return "is not a UNC path with a server and a share";
		segments = [share, ...removeDotSegments(rest)];
	} else if (DRIVE_PATH.test(slashed)) {
		const rest = slashed.slice(2);
		segments = rest === "" ? [] : removeDotSegments(rest.slice(1).split("/"));
	} else {
		return "is not an absolute win32 path";
	}
	for (const segment of segments) {
		const refusal = segmentRefusal(segment);
		if (refusal !== undefined) return refusal;
	}
	return undefined;
};

const toPosixPath = (host: string, tail: ReadonlyArray<string>): Option.Option<string> =>
	host === "" ? Option.some(`/${removeDotSegments(tail).join("/")}`) : Option.none();

const toWin32Path = (host: string, tail: ReadonlyArray<string>): Option.Option<string> => {
	const unc = (server: string, rest: ReadonlyArray<string>): Option.Option<string> => {
		const [share, ...after] = rest;
		if (server === "" || share === undefined || share === "") return Option.none();
		const root = `\\\\${server.toLowerCase()}\\${share}`;
		return Option.some(after.length === 0 ? root : `${root}\\${removeDotSegments(after).join("\\")}`);
	};
	if (host !== "") return unc(host, tail);
	const [first, ...rest] = tail;
	if (first === undefined) return Option.none();
	// `file:////server/share/a`: the UNC host spelled inside the path, as an
	// older `pathToFileURL` and some clients write it.
	if (first === "" && rest.length > 0 && rest[0] !== "") return unc(rest[0] as string, rest.slice(1));
	if (DRIVE.test(first)) {
		return Option.some(`${first.charAt(0).toLowerCase()}:\\${removeDotSegments(rest).join("\\")}`);
	}
	// A rooted path with no drive (`file:///a/b`) names no absolute Windows path.
	return Option.none();
};

// Every win32 answer passes through the refusal `fromPath` applies, so the two
// can never disagree on a device, namespace or malformed UNC path.
const toWin32 = (host: string, tail: ReadonlyArray<string>): Option.Option<string> =>
	Option.filter(toWin32Path(host, tail), (path) => win32Refusal(path) === undefined);

/**
 * Conversion between `file:` URIs and absolute file-system paths, the two
 * spellings every Language Server juggles: LSP names documents by URI
 * (`textDocument.uri`, `rootUri`, `workspaceFolders`), the file system by
 * path. Pure, with no `node:url` and no `process` read, so it runs in a
 * worker or a browser. Not instantiable.
 *
 * @remarks
 * Follows RFC 8089 and RFC 3986, and agrees with Node's `fileURLToPath` /
 * `pathToFileURL` and VS Code's `vscode-uri` (`URI.file`, `fsPath`) wherever
 * they agree with each other. The rulings where they do not:
 *
 * - **A non-`file:` scheme (`untitled:`, `vscode-notebook-cell:`) or a
 *   malformed URI is `Option.none()`, never a throw**: a client may name
 *   any document, and only `file:` documents have paths. So is a `%2F`
 *   inside a segment (it would smuggle a separator into one name), a `%5C`
 *   under `"win32"` (the same), a `%00`, a malformed or non-UTF-8 escape, a
 *   relative `file:` URI, a host under `"posix"`, and a rooted path with no
 *   drive or share under `"win32"`. Node throws for each of these.
 * - **`toPath` never answers a Win32 device or namespace path**, nor any
 *   other path `fromPath` would refuse: `file://./pipe/x` and
 *   `file://%3F/C:/x` would read as `\\.\pipe\x` and `\\?\C:\x`, and
 *   are `Option.none()`, as is a host spelled inside the path
 *   (`file:////./x`). A host must be a plain hostname: dot-separated labels
 *   of ASCII letters, digits, `-` and `_`. The authority is matched as
 *   written, never percent-decoded, so a percent-encoded host is
 *   `Option.none()`, as is a `.` or `?` host, a separator, `%`, NUL,
 *   userinfo, a port, an IPv6 literal, and a UNC share of `.` or `..`.
 * - **`toPath` never answers a path win32 would open as something else**,
 *   and `fromPath` refuses one, through the same check: a segment naming a
 *   DOS device (`CON`, `PRN`, `AUX`, `NUL`, `COM0`-`COM9`, `LPT0`-`LPT9`,
 *   their superscript-digit variants, `CONIN$`, `CONOUT$`), in any case and
 *   with or without an extension (`file:///c:/con` and `file:///c:/a/nul.txt`
 *   are `Option.none()`); a segment holding a `:` after the drive (an NTFS
 *   alternate data stream, `file:///c:/a/b:stream`); and a segment ending in
 *   a dot or a space, which win32 trims, so `c:\a.` would open `c:\a`. Node
 *   reads all of these as paths.
 * - **`.` and `..` segments are removed (RFC 3986 §5.2.4) and never climb
 *   above the root**, in both directions, including their encoded forms
 *   (`%2E%2E`). Node's WHATWG parser collapses them the same way; `vscode-uri`
 *   keeps them. A URI is never a path traversal: `file:///a/../../etc` is
 *   `/etc`.
 * - **A Windows drive letter is lowercase in both directions.** `toPath`
 *   answers `c:\…` for `file:///C:/…`, `file:///c:/…` and VS Code's
 *   `file:///c%3A/…` alike, as `vscode-uri`'s `fsPath` does, so the paths of
 *   one file agree however a client spelled its URI; `fromPath` writes
 *   `file:///c:/…`, RFC 8089's form, with the colon literal. Compare
 *   documents by path, or by a URI this module wrote, never by the client's
 *   URI string.
 * - **Encoding.** `fromPath` percent-encodes every character outside RFC
 *   3986's unreserved set, `/` aside (non-ASCII as UTF-8 bytes, uppercase
 *   hex), as `vscode-uri` does; Node leaves more characters bare. Every
 *   decoder reads both.
 * - **`localhost` is the local machine** (RFC 8089 §2): `file://localhost/a`
 *   is `/a`. Any other host is a UNC path under `"win32"`
 *   (`file://server/share/a` is `\\server\share\a`, host lowercased) and
 *   `Option.none()` under `"posix"`. So `file://localhost/share/a` is
 *   `Option.none()` under `"win32"`, as Node refuses it; `fromPath` writes a
 *   UNC path whose server is literally `localhost` with the host inside the
 *   path, `file:////localhost/share/a`, which `toPath` reads back as
 *   `\\localhost\share\a`. (Node's `pathToFileURL` writes that path as
 *   `file:///share/a`, a different file, and its `fileURLToPath` reads
 *   neither spelling.) An IDN host is read and written only in
 *   its ASCII (punycode) form; neither direction converts it.
 * - A query or fragment is ignored, as Node ignores it.
 *
 * @example
 * ```ts
 * import { LspUri } from "@effected/lsp";
 *
 * console.log(LspUri.toPath("file:///home/me/My%20Project/a.ts"));
 * // => Option.some("/home/me/My Project/a.ts")
 * console.log(LspUri.toPath("untitled:Untitled-1"));
 * // => Option.none()
 * console.log(LspUri.fromPath("C:\\Users\\me\\a.ts", { platform: "win32" }));
 * // => "file:///c:/Users/me/a.ts"
 * ```
 *
 * @public
 */
export class LspUri {
	private constructor() {}

	/**
	 * The absolute path a `file:` URI names, or `Option.none()` when it names
	 * none: a different scheme, or a URI that is malformed or cannot be a path
	 * on `options.platform` (see the class remarks for every case).
	 *
	 * @param uri - A URI as a client sent it, e.g. a `textDocument.uri`.
	 * @param options - The path syntax to answer in; defaults to `"posix"`.
	 * @returns The path, `.` and `..` segments removed, or `Option.none()`.
	 */
	static toPath(uri: string, options?: LspUriOptions): Option.Option<string> {
		if (!FILE_SCHEME.test(uri)) return Option.none();
		let rest = uri.slice("file:".length);
		const hash = rest.indexOf("#");
		if (hash !== -1) rest = rest.slice(0, hash);
		const query = rest.indexOf("?");
		if (query !== -1) rest = rest.slice(0, query);
		let authority = "";
		let path = rest;
		if (rest.startsWith("//")) {
			const slash = rest.indexOf("/", 2);
			authority = slash === -1 ? rest.slice(2) : rest.slice(2, slash);
			path = slash === -1 ? "" : rest.slice(slash);
		}
		if (!path.startsWith("/")) return Option.none();
		// The host is never percent-decoded: a host is a plain hostname, so an
		// encoded one (`%2E`, `%3F`, `a%2Fb`) stays as written and is refused,
		// rather than decoded into a device root or a separator.
		const win32 = options?.platform === "win32";
		const tail: Array<string> = [];
		for (const raw of path.slice(1).split("/")) {
			const segment = decode(raw);
			if (segment === undefined || segment.includes("/") || segment.includes("\0")) return Option.none();
			if (win32 && segment.includes("\\")) return Option.none();
			tail.push(segment);
		}
		const local = authority.toLowerCase() === "localhost" ? "" : authority;
		return win32 ? toWin32(local, tail) : toPosixPath(local, tail);
	}

	/**
	 * The `file:` URI of an absolute path.
	 *
	 * @remarks
	 * The path is taken literally apart from its `.` and `..` segments, which
	 * are removed so the URI round-trips: `toPath(fromPath(p))` is `p`
	 * normalized, and `p` itself for an already-normalized path (a Windows
	 * drive letter lowercased). Under `"win32"`, `\` and `/` both separate,
	 * and a UNC path `\\server\share\…` becomes `file://server/share/…`
	 * (`file:////localhost/share/…` for a server named `localhost`, since
	 * `file://localhost/` is the local machine).
	 *
	 * A path that is not absolute on `options.platform` (`a/b`, `C:a`, or a
	 * rooted `\a` with no drive), one holding a NUL, a lone surrogate, a Win32
	 * device or namespace path (`\\?\…`, `\\.\…`, `\??\…`), a UNC path
	 * whose server is not a plain hostname or whose share is missing, `.` or
	 * `..`, or, under `"win32"`, a segment naming a DOS device (`con`,
	 * `nul.txt`), holding a `:` after the drive (`b:stream`) or ending in a
	 * dot or a space throws a `TypeError`: these are
	 * programmer errors, since a server's own paths are absolute, and no URI
	 * could name them faithfully. Resolve a relative path first, with the
	 * platform's path module.
	 *
	 * @param path - An absolute path in `options.platform`'s syntax.
	 * @param options - The path syntax to read; defaults to `"posix"`.
	 * @returns The URI, e.g. `"file:///home/me/a%20b.ts"`.
	 */
	static fromPath(path: string, options?: LspUriOptions): string {
		if (path.includes("\0")) throw new TypeError("LspUri.fromPath: a path cannot hold a NUL character");
		if (options?.platform !== "win32") {
			if (!path.startsWith("/")) {
				throw new TypeError(`LspUri.fromPath: ${JSON.stringify(path)} is not an absolute posix path`);
			}
			return `file:///${removeDotSegments(path.slice(1).split("/")).map(encode).join("/")}`;
		}
		const refusal = win32Refusal(path);
		if (refusal !== undefined) throw new TypeError(`LspUri.fromPath: ${JSON.stringify(path)} ${refusal}`);
		const slashed = path.replaceAll("\\", "/");
		if (slashed.startsWith("//")) {
			const [server = "", share = "", ...rest] = slashed.slice(2).split("/");
			const after = rest.length === 0 ? "" : `/${removeDotSegments(rest).map(encode).join("/")}`;
			const host = server.toLowerCase();
			// `file://localhost/…` is the local machine (RFC 8089 §2), so a UNC
			// server literally named `localhost` is spelled inside the path,
			// `file:////localhost/share/…`, which `toPath` reads back as UNC.
			return host === "localhost"
				? `file:////${host}/${encode(share)}${after}`
				: `file://${host}/${encode(share)}${after}`;
		}
		const drive = slashed.charAt(0).toLowerCase();
		const rest = slashed.slice(2);
		const segments = rest === "" ? [] : rest.slice(1).split("/");
		return `file:///${drive}:/${removeDotSegments(segments).map(encode).join("/")}`;
	}
}
