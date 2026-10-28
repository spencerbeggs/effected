// LspUri: file: URI <-> path, pure. Node's `node:url` is the differential
// oracle here and only here (src/ never imports it); where the two disagree
// by design (drive-letter case, the encoded set, inputs Node throws on) the
// test states the ruling instead of comparing.

import { fileURLToPath, pathToFileURL } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { LspUri } from "../src/index.js";

const win32 = { platform: "win32" } as const;
const some = (value: string) => Option.some(value);
const none = Option.none<string>();

describe("LspUri.toPath (posix)", () => {
	it("decodes a plain file URI", () => {
		assert.deepStrictEqual(LspUri.toPath("file:///home/me/a.ts"), some("/home/me/a.ts"));
	});

	it("percent-decodes reserved and non-ASCII characters", () => {
		assert.deepStrictEqual(
			LspUri.toPath("file:///a%20b/%23c%3F/caf%C3%A9/%F0%9F%98%80"),
			some("/a b/#c?/café/\u{1F600}"),
		);
	});

	it("accepts the minimal file:/path form, localhost and an uppercase scheme", () => {
		assert.deepStrictEqual(LspUri.toPath("file:/a/b"), some("/a/b"));
		assert.deepStrictEqual(LspUri.toPath("file://localhost/a/b"), some("/a/b"));
		assert.deepStrictEqual(LspUri.toPath("file://LOCALHOST/a"), some("/a"));
		assert.deepStrictEqual(LspUri.toPath("FILE:///a"), some("/a"));
	});

	it("ignores a query and a fragment", () => {
		assert.deepStrictEqual(LspUri.toPath("file:///a/b.ts?x=1#L10"), some("/a/b.ts"));
		assert.deepStrictEqual(LspUri.toPath("file:///a/b.ts#frag?not-a-query"), some("/a/b.ts"));
	});

	it("keeps the root and a trailing slash", () => {
		assert.deepStrictEqual(LspUri.toPath("file:///"), some("/"));
		assert.deepStrictEqual(LspUri.toPath("file:///a/"), some("/a/"));
	});

	it("removes dot segments, encoded ones included, and never climbs above the root", () => {
		assert.deepStrictEqual(LspUri.toPath("file:///a/./b/../c"), some("/a/c"));
		assert.deepStrictEqual(LspUri.toPath("file:///a/../../../etc/passwd"), some("/etc/passwd"));
		assert.deepStrictEqual(LspUri.toPath("file:///a/%2E%2E/%2e/b"), some("/b"));
		assert.deepStrictEqual(LspUri.toPath("file:///a/b/.."), some("/a/"));
	});

	it("answers none for a non-file scheme", () => {
		for (const uri of [
			"untitled:Untitled-1",
			"vscode-notebook-cell:/a.ipynb#c1",
			"https://example.com/a",
			"a.ts",
			"",
		]) {
			assert.deepStrictEqual(LspUri.toPath(uri), none, uri);
		}
	});

	it("answers none for a separator or NUL smuggled into a segment", () => {
		assert.deepStrictEqual(LspUri.toPath("file:///a%2Fb"), none);
		assert.deepStrictEqual(LspUri.toPath("file:///a%2fb"), none);
		assert.deepStrictEqual(LspUri.toPath("file:///a%00b"), none);
		// Positive control: the same shape without the smuggled byte decodes.
		assert.deepStrictEqual(LspUri.toPath("file:///a%41b"), some("/aAb"));
		// A backslash is an ordinary posix filename character.
		assert.deepStrictEqual(LspUri.toPath("file:///a%5Cb"), some("/a\\b"));
	});

	it("answers none for malformed escapes, invalid UTF-8, relative forms and a host", () => {
		for (const uri of [
			"file:///a%",
			"file:///a%zz",
			"file:///a%C3",
			"file:///a%FF",
			"file:a/b",
			"file:",
			"file://",
			"file://server/share/a",
			"file://%zz/a",
			"file://%6Cocalhost/a",
			"file://user@localhost/a",
		]) {
			assert.deepStrictEqual(LspUri.toPath(uri), none, uri);
		}
	});
});

describe("LspUri.toPath (win32)", () => {
	it("decodes a drive path, lowercasing the drive letter however the client spelled it", () => {
		for (const uri of [
			"file:///C:/Users/me/a.ts",
			"file:///c:/Users/me/a.ts",
			"file:///c%3A/Users/me/a.ts",
			"file:///C%3a/Users/me/a.ts",
			"file:///C|/Users/me/a.ts",
		]) {
			assert.deepStrictEqual(LspUri.toPath(uri, win32), some("c:\\Users\\me\\a.ts"), uri);
		}
	});

	it("answers a bare drive as its root", () => {
		assert.deepStrictEqual(LspUri.toPath("file:///C:", win32), some("c:\\"));
		assert.deepStrictEqual(LspUri.toPath("file:///C:/", win32), some("c:\\"));
	});

	it("decodes UNC paths from a host or from a path-spelled host", () => {
		assert.deepStrictEqual(LspUri.toPath("file://Server/Share/a%20b/c", win32), some("\\\\server\\Share\\a b\\c"));
		assert.deepStrictEqual(LspUri.toPath("file:////server/share/c", win32), some("\\\\server\\share\\c"));
		assert.deepStrictEqual(LspUri.toPath("file://server/share", win32), some("\\\\server\\share"));
		assert.deepStrictEqual(LspUri.toPath("file://server/share/a/../../..", win32), some("\\\\server\\share\\"));
	});

	it("treats localhost as the local machine", () => {
		assert.deepStrictEqual(LspUri.toPath("file://localhost/C:/a", win32), some("c:\\a"));
	});

	it("never climbs above a drive", () => {
		assert.deepStrictEqual(LspUri.toPath("file:///c:/a/../../Windows", win32), some("c:\\Windows"));
	});

	it("answers none for a smuggled separator, a rootless path or a shareless UNC", () => {
		for (const uri of [
			"file:///c:/a%5Cb",
			"file:///c:/a%2Fb",
			"file:///c:/a%00",
			"file:///a/b",
			"file://server",
			"file://server/",
			"file:////server",
			"untitled:Untitled-1",
		]) {
			assert.deepStrictEqual(LspUri.toPath(uri, win32), none, uri);
		}
	});
	it("answers none for a device or namespace host, raw or percent-encoded", () => {
		// Each of these would read as `\\.\…`, `\\?\…` or `\\??\…`: a Win32
		// device or namespace path, which fromPath refuses to write.
		for (const uri of [
			"file://./pipe/evil",
			"file://%2E/pipe/evil",
			"file://%2e/pipe/evil",
			"file://%3F/C:/x",
			"file://%3f/C:/x",
			"file://%3F%3F/C:/x",
			"file:////./PhysicalDrive0/x",
			"file:////%2E/pipe/evil",
			"file:////%3F/UNC/srv/share",
			"file:////%3F/C:/x",
			"file:////%3F%3F/C:/x",
			"file://../share/x",
		]) {
			assert.deepStrictEqual(LspUri.toPath(uri, win32), none, uri);
		}
	});

	it("answers none for a host that is not a plain hostname", () => {
		for (const uri of [
			"file://a%2Fb/x",
			"file://a%2fb/share/x",
			"file://a%5Cb/share/x",
			"file://a%25b/share/x",
			"file://a%00b/share/x",
			"file://a%20b/share/x",
			"file://%73erver/share/x",
			"file://user@server/share/x",
			"file://server:445/share/x",
			"file://[::1]/share/x",
			"file://server./share/x",
			"file://.server/share/x",
			"file://a..b/share/x",
			"file://caf%C3%A9/share/x",
			"file:////a%25b/share/x",
			"file:////a%20b/share/x",
		]) {
			assert.deepStrictEqual(LspUri.toPath(uri, win32), none, uri);
		}
		// Positive controls: hostnames with dots, digits, hyphens and underscores.
		assert.deepStrictEqual(
			LspUri.toPath("file://srv-01.corp_x.example/s/x", win32),
			some("\\\\srv-01.corp_x.example\\s\\x"),
		);
		assert.deepStrictEqual(LspUri.toPath("file://10.0.0.1/s", win32), some("\\\\10.0.0.1\\s"));
	});

	it("answers none for a dot-segment share", () => {
		for (const uri of ["file://server/./x", "file://server/../x", "file://server/%2E%2E/x", "file:////server/../x"]) {
			assert.deepStrictEqual(LspUri.toPath(uri, win32), none, uri);
		}
	});
});

describe("LspUri.fromPath", () => {
	it("encodes a posix path with RFC 3986's unreserved set left bare", () => {
		assert.strictEqual(LspUri.fromPath("/home/me/a.ts"), "file:///home/me/a.ts");
		assert.strictEqual(LspUri.fromPath("/a b/#c?/café/!'()*~"), "file:///a%20b/%23c%3F/caf%C3%A9/%21%27%28%29%2A~");
		assert.strictEqual(LspUri.fromPath("/a%2Fb"), "file:///a%252Fb");
		assert.strictEqual(LspUri.fromPath("/a\\b"), "file:///a%5Cb");
		assert.strictEqual(LspUri.fromPath("/"), "file:///");
	});

	it("removes dot segments so the URI round-trips", () => {
		assert.strictEqual(LspUri.fromPath("/a/./b/../c/"), "file:///a/c/");
		assert.strictEqual(LspUri.fromPath("/../../etc"), "file:///etc");
	});

	it("writes win32 drive paths with a lowercase drive and a literal colon", () => {
		assert.strictEqual(LspUri.fromPath("C:\\Users\\me\\a b.ts", win32), "file:///c:/Users/me/a%20b.ts");
		assert.strictEqual(LspUri.fromPath("c:/Users/me", win32), "file:///c:/Users/me");
		assert.strictEqual(LspUri.fromPath("C:", win32), "file:///c:/");
		assert.strictEqual(LspUri.fromPath("C:\\", win32), "file:///c:/");
		assert.strictEqual(LspUri.fromPath("C:\\a\\..\\..\\b", win32), "file:///c:/b");
	});

	it("writes UNC paths with the server as the host", () => {
		assert.strictEqual(LspUri.fromPath("\\\\Server\\Share\\a b", win32), "file://server/Share/a%20b");
		assert.strictEqual(LspUri.fromPath("\\\\server\\share", win32), "file://server/share");
	});

	it("throws a TypeError for a path no URI can name faithfully", () => {
		const cases: ReadonlyArray<[string, "posix" | "win32"]> = [
			["a/b", "posix"],
			["", "posix"],
			["C:\\a", "posix"],
			["/a\0b", "posix"],
			["/a\uD800b", "posix"],
			["a\\b", "win32"],
			["C:a", "win32"],
			["\\a", "win32"],
			["\\\\server", "win32"],
			["\\\\?\\C:\\a", "win32"],
			["\\\\.\\pipe\\x", "win32"],
			["C:\\a\0", "win32"],
			["\\\\??\\C:\\a", "win32"],
			["/??/C:/a", "win32"],
			["\\\\.\\", "win32"],
			["\\\\?\\", "win32"],
			["\\\\.", "win32"],
			["\\\\..\\share\\x", "win32"],
			["\\\\a%b\\share", "win32"],
			["\\\\a b\\share", "win32"],
			["\\\\user@server\\share", "win32"],
			["\\\\server:445\\share", "win32"],
			["\\\\server.\\share", "win32"],
			["\\\\café\\share", "win32"],
			["\\\\server\\.\\x", "win32"],
			["\\\\server\\..\\x", "win32"],
		];
		for (const [path, platform] of cases) {
			assert.throws(
				() => LspUri.fromPath(path, { platform }),
				TypeError,
				undefined,
				`${platform} ${JSON.stringify(path)}`,
			);
		}
	});
});

describe("LspUri.fromPath device and namespace paths", () => {
	it("names a device or namespace path as one", () => {
		for (const path of ["\\\\?\\C:\\a", "\\\\.\\pipe\\x", "\\??\\C:\\a", "//?/C:/a"]) {
			assert.throws(() => LspUri.fromPath(path, win32), TypeError, "Win32 device or namespace path", path);
		}
	});
});

// The superscript digits win32 also reads as COM/LPT port numbers.
const SUPERSCRIPTS = [0xb9, 0xb2, 0xb3].map((code) => String.fromCodePoint(code));

describe("LspUri DOS device names, alternate data streams and trimmed segments (win32)", () => {
	// The same set as @effected/walker's win32 reservedName check, plus a
	// segment ending in a dot or a space (walker refuses only an all-dots-and-
	// spaces segment).
	const refused = [
		"con",
		"CON",
		"Prn",
		"aux",
		"nul",
		"con.txt",
		"NUL.tar.gz",
		"con .txt",
		"con ",
		"conin$",
		"CONOUT$",
		...Array.from({ length: 10 }, (_, digit) => `com${digit}`),
		...Array.from({ length: 10 }, (_, digit) => `LPT${digit}`),
		...SUPERSCRIPTS.flatMap((digit) => [`com${digit}`, `lpt${digit}.log`]),
		"b:stream",
		"b::$DATA",
		"a.",
		"a ",
		"...",
		". ",
	];
	const accepted = ["console", "nul_", "com", "com10", "lpt", "a.b", "con-x.txt", "auxiliary", ".a", " a"];

	it("fromPath throws for a refused segment in any position, drive or UNC", () => {
		for (const segment of refused) {
			for (const path of [`C:\\${segment}`, `C:\\a\\${segment}\\b`, `\\\\server\\share\\${segment}`]) {
				assert.throws(() => LspUri.fromPath(path, win32), TypeError, undefined, JSON.stringify(path));
			}
		}
		assert.throws(() => LspUri.fromPath("\\\\server\\con\\a", win32), TypeError, "DOS device");
		assert.throws(() => LspUri.fromPath("C:\\a\\b:stream", win32), TypeError, "alternate data stream");
		assert.throws(() => LspUri.fromPath("C:\\a.", win32), TypeError, "dot or a space");
	});

	it("toPath answers none for a refused segment, raw or percent-encoded", () => {
		for (const segment of refused) {
			const encoded = encodeURIComponent(segment);
			for (const uri of [
				`file:///c:/${encoded}`,
				`file:///C:/a/${encoded}/b`,
				`file://server/share/${encoded}`,
				`file://server/${encoded}/x`,
			]) {
				assert.deepStrictEqual(LspUri.toPath(uri, win32), none, uri);
			}
		}
		assert.deepStrictEqual(LspUri.toPath("file:///c:/con", win32), none);
		assert.deepStrictEqual(LspUri.toPath("file:///c:/a/b:stream", win32), none);
		assert.deepStrictEqual(LspUri.toPath("file:///c:/a/b%3Astream", win32), none);
	});

	it("accepts names that only resemble a device, and checks segments after dot removal", () => {
		for (const segment of accepted) {
			assert.deepStrictEqual(
				LspUri.toPath(LspUri.fromPath(`C:\\a\\${segment}`, win32), win32),
				some(`c:\\a\\${segment}`),
			);
		}
		// The drive's own colon, and `.`/`..` segments both directions remove.
		assert.strictEqual(LspUri.fromPath("C:\\a\\.\\b\\..\\c", win32), "file:///c:/a/c");
		assert.strictEqual(LspUri.fromPath("C:\\con\\..\\a", win32), "file:///c:/a");
		assert.deepStrictEqual(LspUri.toPath("file:///c:/con/../a", win32), some("c:\\a"));
	});

	it("leaves posix paths alone: none of these are special there", () => {
		for (const segment of ["con", "nul.txt", "b:stream", "a.", "a "]) {
			const path = `/a/${segment}`;
			assert.deepStrictEqual(LspUri.toPath(LspUri.fromPath(path)), some(path));
		}
	});
});

describe("LspUri UNC paths on a server named localhost (win32)", () => {
	it("writes the host inside the path, so the round trip holds", () => {
		assert.strictEqual(LspUri.fromPath("\\\\localhost\\share\\x", win32), "file:////localhost/share/x");
		assert.strictEqual(LspUri.fromPath("\\\\LocalHost\\share", win32), "file:////localhost/share");
		assert.deepStrictEqual(LspUri.toPath("file:////localhost/share/x", win32), some("\\\\localhost\\share\\x"));
		assert.deepStrictEqual(
			LspUri.toPath(LspUri.fromPath("\\\\localhost\\share\\x", win32), win32),
			some("\\\\localhost\\share\\x"),
		);
		// A server that only starts like localhost keeps the host form.
		assert.strictEqual(LspUri.fromPath("\\\\localhost2\\share\\x", win32), "file://localhost2/share/x");
	});

	it("reads file://localhost/share/x as the local machine, which has no such path", () => {
		assert.deepStrictEqual(LspUri.toPath("file://localhost/share/x", win32), none);
		assert.deepStrictEqual(LspUri.toPath("file://LOCALHOST/c:/a", win32), some("c:\\a"));
	});

	it("matches node:url, which reads neither spelling and writes a different file", () => {
		// The reference reader: Node's WHATWG parser empties a `localhost` host,
		// so both URIs reach its win32 reader as a driveless path and throw.
		for (const uri of ["file://localhost/share/x", "file:////localhost/share/x"]) {
			assert.throws(() => fileURLToPath(uri, { windows: true }), TypeError, "must be absolute", uri);
		}
		// Node's writer drops the server: `\share\x`, not `\\localhost\share\x`.
		assert.strictEqual(pathToFileURL("\\\\localhost\\share\\x", { windows: true }).href, "file:///share/x");
	});
});

// Every path of up to four segments over an adversarial segment alphabet.
const SEGMENTS = ["a", "a b", "%", "%2F", "#?", "é", "\u{1F600}", ".", "..", "", "~!*", "x:y"];
// `x:y` is an alternate data stream under win32, which both directions refuse.
const WIN32_SEGMENTS = SEGMENTS.filter((segment) => segment !== "x:y");
const paths = (
	prefix: string,
	separator: string,
	segments: ReadonlyArray<string> = SEGMENTS,
): ReadonlyArray<string> => {
	const out: Array<string> = [];
	let frontier = [prefix];
	for (let depth = 1; depth <= 3; depth++) {
		frontier = frontier.flatMap((head) =>
			segments.map((segment) => `${head}${depth === 1 ? "" : separator}${segment}`),
		);
		out.push(...frontier);
	}
	return out;
};

// The differential asks Node to READ URIs, never to make normal forms:
// `pathToFileURL` normalizes through `path.resolve` (dropping a trailing
// slash, climbing above a UNC share, and under `windows: true` on a posix host
// writing `C:\` as `file:///C://`), so its URI for a path is not a fixed point
// to compare against. Its WHATWG reader is.
const lowerDrive = (path: string): string =>
	/^[A-Z]:/.test(path) ? `${path.charAt(0).toLowerCase()}${path.slice(1)}` : path;
const DOT_POSIX = /(^|\/)\.\.?(\/|$)/;
const DOT_WIN32 = /(^|\\)\.\.?(\\|$)/;

describe("round trips and the node:url differential", () => {
	const posix = paths("/", "/");
	const windows = paths("C:\\", "\\", WIN32_SEGMENTS);
	const uncTails = paths("", "\\", WIN32_SEGMENTS).filter((tail) => tail !== "");
	const unc = uncTails.map((tail) => `\\\\server\\share\\${tail}`);
	// Node cannot read a UNC path on a server named `localhost` at all, so this
	// corpus joins only the fixed-point round trip, never the differential.
	const localhost = uncTails.map((tail) => `\\\\localhost\\share\\${tail}`);

	it("enumerates the corpora", () => {
		assert.strictEqual(posix.length, 12 + 144 + 1728);
		assert.strictEqual(windows.length, 11 + 121 + 1331);
		assert.isAbove(unc.length, 1400);
		assert.strictEqual(localhost.length, unc.length);
	});

	it("posix: Node reads our URI as the path we read it as", () => {
		for (const path of posix) {
			const uri = LspUri.fromPath(path);
			assert.deepStrictEqual(LspUri.toPath(uri), some(fileURLToPath(uri, { windows: false })), uri);
		}
	});

	it("posix: we read Node's URI for a path as Node reads it", () => {
		for (const path of posix) {
			const uri = pathToFileURL(path, { windows: false }).href;
			assert.deepStrictEqual(LspUri.toPath(uri), some(fileURLToPath(uri, { windows: false })), uri);
		}
	});

	it("posix: toPath(fromPath(p)) is a fixed point, and a dot-free path round-trips to itself", () => {
		let identities = 0;
		for (const path of posix) {
			const normal = Option.getOrThrow(LspUri.toPath(LspUri.fromPath(path)));
			assert.strictEqual(LspUri.fromPath(normal), LspUri.fromPath(path), JSON.stringify(path));
			if (!DOT_POSIX.test(path)) {
				identities++;
				assert.strictEqual(normal, path, JSON.stringify(path));
			}
		}
		assert.isAbove(identities, 1000, "the corpus must hold dot-free paths");
	});

	it("win32: Node reads our URI as the path we read it as, drive case aside", () => {
		for (const path of [...windows, ...unc]) {
			const uri = LspUri.fromPath(path, win32);
			assert.deepStrictEqual(LspUri.toPath(uri, win32), some(lowerDrive(fileURLToPath(uri, { windows: true }))), uri);
		}
	});

	it("win32: we read Node's URI for a path as Node reads it, drive case aside", () => {
		let shareless = 0;
		for (const path of [...windows, ...unc]) {
			const uri = pathToFileURL(path, { windows: true }).href;
			// Node's resolver climbs above the share (`\\server\share\..` is
			// `file://server/`, and an empty share gives `file://server//a`); a
			// UNC path with no share names nothing, and is ours to refuse.
			if (/^file:\/\/[^/]+(?:\/?$|\/\/)/.test(uri)) {
				shareless++;
				assert.deepStrictEqual(LspUri.toPath(uri, win32), none, uri);
				continue;
			}
			assert.deepStrictEqual(LspUri.toPath(uri, win32), some(lowerDrive(fileURLToPath(uri, { windows: true }))), uri);
		}
		assert.isAbove(shareless, 0, "the corpus must reach Node's climb above the share");
	});

	it("win32: toPath(fromPath(p)) is a fixed point, and a dot-free path round-trips to itself", () => {
		let identities = 0;
		for (const path of [...windows, ...unc, ...localhost]) {
			const normal = Option.getOrThrow(LspUri.toPath(LspUri.fromPath(path, win32), win32));
			assert.strictEqual(LspUri.fromPath(normal, win32), LspUri.fromPath(path, win32), JSON.stringify(path));
			if (!DOT_WIN32.test(path)) {
				identities++;
				assert.strictEqual(normal, lowerDrive(path), JSON.stringify(path));
			}
		}
		assert.isAbove(identities, 2000, "the corpus must hold dot-free paths");
	});
});

// toPath and fromPath refuse one set: whatever path toPath answers, fromPath
// must accept. Checked over every URI of up to three segments, with and
// without an authority, over an alphabet of the tokens that reach a device,
// namespace or malformed UNC path: dots, `?`, separators raw and encoded,
// `%`, NUL, drive segments and hostname-looking names.
const URI_TOKENS = [
	"",
	".",
	"..",
	"?",
	"??",
	"%2E",
	"%2E%2E",
	"%3F",
	"%3F%3F",
	"%2F",
	"%5C",
	"%25",
	"%00",
	"%20",
	"a",
	"server",
	"srv.example",
	"a%2Fb",
	"a%5Cb",
	"C:",
	"c%3A",
	"C|",
	"UNC",
	"pipe",
	"localhost",
	"user@h",
	"h:1",
	"caf%C3%A9",
	// DOS devices, alternate data streams and the trailing dot and space win32
	// trims: each must be refused by toPath wherever fromPath refuses it.
	"con",
	"CON.txt",
	"nul%20.txt",
	"Com0",
	"lpt%C2%B9",
	"conin$",
	"b:stream",
	"b%3A%24DATA",
	"a.",
	"a%20",
	"...",
];

const uris = (): ReadonlyArray<string> => {
	const out: Array<string> = [];
	for (const head of ["file:///", "file://", "file:////"]) {
		for (const a of URI_TOKENS) {
			for (const b of URI_TOKENS) {
				out.push(`${head}${a}/${b}`);
				for (const c of ["", "x", "%2E%2E", "C:"]) out.push(`${head}${a}/${b}/${c}`);
			}
		}
	}
	return out;
};

describe("toPath never answers a path fromPath refuses", () => {
	const corpus = uris();

	for (const platform of ["posix", "win32"] as const) {
		it(`${platform}: every path toPath answers is one fromPath writes`, () => {
			let answered = 0;
			for (const uri of corpus) {
				const path = LspUri.toPath(uri, { platform });
				if (Option.isNone(path)) continue;
				answered++;
				// Not assert.doesNotThrow: its third argument matches the thrown
				// message, so a label passed there makes the check vacuous.
				try {
					LspUri.fromPath(path.value, { platform });
				} catch (error) {
					assert.fail(`${uri} => ${JSON.stringify(path.value)}: fromPath refuses it (${String(error)})`);
				}
			}
			// The corpus must reach both answers, or the property checks nothing.
			assert.isAbove(answered, 1000, "the corpus must reach paths toPath answers");
			assert.isBelow(answered, corpus.length, "the corpus must reach URIs toPath refuses");
		});
	}
});
