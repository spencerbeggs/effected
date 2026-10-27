import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Option, Schema } from "effect";
import type { GitRemoteForm } from "../src/GitRemote.js";
import { GitRemote, GitRemotePath, GitRemoteScp, GitRemoteTransport, GitRemoteUrl } from "../src/GitRemote.js";

const parsed = (raw: string): GitRemoteForm => Option.getOrThrow(GitRemote.parse(raw));

describe("GitRemote.parse — forms and verbatim parts", () => {
	const cases: ReadonlyArray<readonly [string, GitRemoteForm]> = [
		["https://github.com/o/n.git", GitRemoteUrl.make({ scheme: "https", host: "github.com", path: "/o/n.git" })],
		[
			"ssh://git@github.com:22/o/n.git",
			GitRemoteUrl.make({ scheme: "ssh", user: "git", host: "github.com", port: "22", path: "/o/n.git" }),
		],
		[
			"git+ssh://git@github.com/o/n.git",
			GitRemoteUrl.make({ scheme: "git+ssh", user: "git", host: "github.com", path: "/o/n.git" }),
		],
		["HTTPS://GitHub.com/O/N/", GitRemoteUrl.make({ scheme: "HTTPS", host: "GitHub.com", path: "/O/N/" })],
		["file:///srv/r.git", GitRemoteUrl.make({ scheme: "file", host: "", path: "/srv/r.git" })],
		["https://host", GitRemoteUrl.make({ scheme: "https", host: "host", path: "" })],
		["https://", GitRemoteUrl.make({ scheme: "https", host: "", path: "" })],
		["https://h/o/n?x=1#f", GitRemoteUrl.make({ scheme: "https", host: "h", path: "/o/n?x=1#f" })],
		["https://h?tok=1", GitRemoteUrl.make({ scheme: "https", host: "h", path: "?tok=1" })],
		["ssh://[::1]:2222/o/n", GitRemoteUrl.make({ scheme: "ssh", host: "[::1]", port: "2222", path: "/o/n" })],
		["ssh://[::1]/o/n", GitRemoteUrl.make({ scheme: "ssh", host: "[::1]", path: "/o/n" })],
		// git's scheme grammar admits a leading digit, and git treats ANY `://` as a URL (probed).
		["1http://h/x", GitRemoteUrl.make({ scheme: "1http", host: "h", path: "/x" })],
		["host:path://x", GitRemoteUrl.make({ scheme: "host:path", host: "x", path: "" })],
		["git@github.com:o/n.git", GitRemoteScp.make({ user: "git", host: "github.com", path: "o/n.git" })],
		["github.com:o/n", GitRemoteScp.make({ host: "github.com", path: "o/n" })],
		["github:foo/bar", GitRemoteScp.make({ host: "github", path: "foo/bar" })],
		["git@[::1]:o/n", GitRemoteScp.make({ user: "git", host: "[::1]", path: "o/n" })],
		["[host:22]:o/n", GitRemoteScp.make({ host: "[host:22]", path: "o/n" })],
		// git 2.56, recorded through GIT_SSH_COMMAND: a plain strchr(':') picks
		// scp, and host_end's bracket rule only moves the separator search.
		["[a:b/c]:d", GitRemoteScp.make({ host: "[a:b/c]", path: "d" })],
		["[::1]/foo:bar", GitRemoteScp.make({ host: "[::1]/foo", path: "bar" })],
		["foo[:]/bar", GitRemoteScp.make({ host: "foo[", path: "]/bar" })],
		["git@host:[x]:y", GitRemoteScp.make({ user: "git", host: "host", path: "[x]:y" })],
		// git dies "no path specified" here; the parser falls back to the first `:`.
		["[a:b]", GitRemoteScp.make({ host: "[a", path: "b]" })],
		["u:s3cret@host:repo", GitRemoteScp.make({ host: "u", path: "s3cret@host:repo" })],
		["C:/x/y", GitRemoteScp.make({ host: "C", path: "/x/y" })],
		["C:\\x\\y", GitRemoteScp.make({ host: "C", path: "\\x\\y" })],
		["host:", GitRemoteScp.make({ host: "host", path: "" })],
		[":leading-colon", GitRemoteScp.make({ host: "", path: "leading-colon" })],
		["user@:x", GitRemoteScp.make({ user: "user", host: "", path: "x" })],
		["/srv/repo.git", GitRemotePath.make({ path: "/srv/repo.git" })],
		["../sibling.git", GitRemotePath.make({ path: "../sibling.git" })],
		["./a:b", GitRemotePath.make({ path: "./a:b" })],
		["owner/name", GitRemotePath.make({ path: "owner/name" })],
		["not-a-url", GitRemotePath.make({ path: "not-a-url" })],
		[
			"persistent::https://u:s3cret@host/r",
			GitRemoteTransport.make({
				transport: "persistent",
				address: GitRemoteUrl.make({ scheme: "https", user: "u", host: "host", path: "/r" }),
			}),
		],
		["1a::x", GitRemoteTransport.make({ transport: "1a", address: GitRemotePath.make({ path: "x" }) })],
		[
			"ext::ssh -i k host %S",
			GitRemoteTransport.make({ transport: "ext", address: GitRemotePath.make({ path: "ssh -i k host %S" }) }),
		],
		// The helper receives everything after the FIRST `::` (probed with a stub helper).
		["a::b::c", GitRemoteTransport.make({ transport: "a", address: GitRemoteScp.make({ host: "b", path: ":c" }) })],
		["host::path", GitRemoteTransport.make({ transport: "host", address: GitRemotePath.make({ path: "path" }) })],
		// Not transports: `_` is not a scheme character, and the run must start alphanumeric.
		["a_b::x", GitRemoteScp.make({ host: "a_b", path: ":x" })],
		["-a::x", GitRemoteScp.make({ host: "-a", path: ":x" })],
	];
	for (const [raw, expected] of cases) {
		it(`parses ${JSON.stringify(raw)}`, () => {
			assert.deepStrictEqual(parsed(raw), expected);
		});
	}

	it("is Option.none only for blank input", () => {
		for (const raw of ["", "   ", "\t\n"]) {
			assert.isTrue(Option.isNone(GitRemote.parse(raw)), JSON.stringify(raw));
		}
	});

	it("splits an scp user at the LAST @, as ssh does (a first-@ split would give user 'u', host 'a@b')", () => {
		assert.deepStrictEqual(parsed("u@a@b:o/n"), GitRemoteScp.make({ user: "u@a", host: "b", path: "o/n" }));
	});

	it("does not trim: surrounding whitespace stays in the parts", () => {
		assert.deepStrictEqual(parsed(" /srv/r "), GitRemotePath.make({ path: " /srv/r " }));
	});
});

describe("GitRemote — a URL password is never retained", () => {
	// Each password holds a character that ends an authority in some parser.
	const passwords = ["pa/ss", "p@ss", "p?ss", "p:ss", "p#ss", "a/b@c?d:e#f", "s3cret"];
	for (const password of passwords) {
		it(`drops ${JSON.stringify(password)} whole`, () => {
			for (const raw of [`https://u:${password}@host/r`, `persistent::https://u:${password}@host/r`]) {
				const remote = parsed(raw);
				const address = remote._tag === "GitRemoteTransport" ? remote.address : remote;
				assert.deepStrictEqual(address, GitRemoteUrl.make({ scheme: "https", user: "u", host: "host", path: "/r" }));
				assert.notInclude(JSON.stringify(remote), password, raw);
				assert.notInclude(GitRemote.format(remote), password, raw);
			}
		});
	}

	it("an empty user with a password keeps the empty user and drops the password", () => {
		assert.deepStrictEqual(
			parsed("https://:tok3n@host/r"),
			GitRemoteUrl.make({ scheme: "https", user: "", host: "host", path: "/r" }),
		);
	});
});

describe("GitRemote.format, redact and repositoryPath", () => {
	it("re-renders each form", () => {
		for (const raw of [
			"ssh://git@h:22/o/n.git",
			"git@h:o/n.git",
			"/srv/r",
			"https://h",
			"ssh://[::1]:1/x",
			"persistent::git@h:o/n",
		]) {
			assert.strictEqual(GitRemote.format(parsed(raw)), raw);
		}
	});

	it("redact masks the user and the query, keeping scheme, host, port and path", () => {
		const redacted = (raw: string): string => GitRemote.format(GitRemote.redact(parsed(raw)));
		assert.strictEqual(redacted("https://ghp_tok@github.com/o/n.git"), "https://<redacted>@github.com/o/n.git");
		assert.strictEqual(redacted("https://u:p@h:8443/o/n?token=abc#frag"), "https://<redacted>@h:8443/o/n?<redacted>");
		assert.strictEqual(redacted("https://h?tok=1"), "https://h?<redacted>");
		assert.strictEqual(redacted("git@github.com:o/n.git"), "<redacted>@github.com:o/n.git");
		assert.strictEqual(
			redacted("persistent::https://ghp_tok@host/r?x=1"),
			"persistent::https://<redacted>@host/r?<redacted>",
		);
		assert.strictEqual(redacted("https://github.com/o/n"), "https://github.com/o/n");
		// An invalid scheme is text before a late `://` and may hold anything.
		assert.strictEqual(redacted("u:pw@h://x"), "<redacted>://x");
		assert.strictEqual(redacted("1http://h/x"), "<redacted>://h/x");
		assert.strictEqual(redacted("git+ssh://h/x"), "git+ssh://h/x");
		// git reads `u:s3cret@host:repo` as path `s3cret@host:repo`: the scp
		// path is masked through its LAST `@` (over-masks by design), because
		// the secret may itself hold a `/` (`h:s3c/ret@x`).
		assert.strictEqual(redacted("u:s3cret@host:repo"), "u:<redacted>@host:repo");
		assert.strictEqual(redacted("h:s3c/ret@x"), "h:<redacted>@x");
		assert.strictEqual(redacted("git@h:o/n@v1"), "<redacted>@h:<redacted>@v1");
		assert.strictEqual(redacted("git@host:o/n@v1"), "<redacted>@host:<redacted>@v1");
		// An `@` in a URL path is read as userinfo, by design: the host is lost.
		assert.deepStrictEqual(
			parsed("https://h/pkg@1.0/r.git"),
			GitRemoteUrl.make({ scheme: "https", user: "h/pkg", host: "1.0", path: "/r.git" }),
		);
		assert.strictEqual(redacted("https://h/pkg@1.0/r.git"), "https://<redacted>@1.0/r.git");
		assert.strictEqual(redacted("git@h:o/n.git"), "<redacted>@h:o/n.git");
		assert.strictEqual(redacted("/srv/r?x"), "/srv/r?x");
	});

	it("repositoryPath strips a URL's leading /, then one trailing /, then one .git", () => {
		assert.strictEqual(GitRemote.repositoryPath(parsed("https://github.com/o/n.git")), "o/n");
		assert.strictEqual(GitRemote.repositoryPath(parsed("https://github.com/o/n.git/")), "o/n");
		assert.strictEqual(GitRemote.repositoryPath(parsed("git@github.com:o/n.git")), "o/n");
		assert.strictEqual(GitRemote.repositoryPath(parsed("/srv/r.git")), "/srv/r");
		assert.strictEqual(GitRemote.repositoryPath(parsed("https://h/O/N")), "O/N");
		assert.strictEqual(GitRemote.repositoryPath(parsed("persistent::https://h/o/n.git")), "o/n");
	});
});

describe("GitRemote properties", () => {
	// An alphabet dense in every character the grammar branches on, so random
	// strings hit the transport, scheme, userinfo, bracket and scp/path
	// decisions often.
	const ALPHABET = ["a", "B", "1", ".", "-", "+", "_", "/", ":", "@", "[", "]", "?", "#", "\\", " ", "\n", "é"];
	const gitish = Arbitrary.array(Arbitrary.schema(Schema.Literals(ALPHABET)), { maxLength: 40 }).pipe(
		Arbitrary.map((chars) => chars.join("")),
	);
	const schemed = Arbitrary.all([
		Arbitrary.schema(Schema.Literals(["https://", "ssh://", "git+ssh://", "file://", "zz::https://", "a::"])),
		gitish,
	]).pipe(Arbitrary.map(([scheme, rest]) => `${scheme}${rest}`));

	/**
	 * Whether a URL-form input carries a password — the one part format cannot
	 * restore. Written from the documented rule (userinfo runs to the last `@`
	 * after `://`), not from the implementation.
	 */
	const hasPassword = (raw: string): boolean => {
		const transport = /^[A-Za-z0-9][A-Za-z0-9+.-]*::/.exec(raw);
		const address = transport === null ? raw : raw.slice(transport[0].length);
		const separator = address.indexOf("://");
		if (separator === -1) return false;
		const rest = address.slice(separator + 3);
		const at = rest.lastIndexOf("@");
		return at !== -1 && rest.slice(0, at).includes(":");
	};

	const roundTrips = (raw: string): boolean => {
		const result = GitRemote.parse(raw);
		if (Option.isNone(result)) return raw.trim() === "";
		return hasPassword(raw) || GitRemote.format(result.value) === raw;
	};

	it.prop(
		"parse is total and format(parse(raw)) === raw for git-alphabet strings",
		[gitish],
		([raw]) => roundTrips(raw),
		{
			arbitrary: { runs: 2000 },
		},
	);

	it.prop(
		"parse is total and round-trips for scheme- and transport-led strings",
		[schemed],
		([raw]) => roundTrips(raw),
		{
			arbitrary: { runs: 2000 },
		},
	);

	it.prop("parse is total and round-trips for arbitrary strings", [Schema.String], ([raw]) => roundTrips(raw), {
		arbitrary: { runs: 1000 },
	});

	// No filter on the password: it may hold `/`, `:`, `@`, `?`, `#` and
	// anything else in the alphabet. The user is the one constraint, because a
	// `:` in it would move the user/password split.
	it.prop(
		"a password of any git-alphabet text is dropped whole: format removes exactly it, and no part holds it",
		[gitish, gitish, Arbitrary.schema(Schema.Literals(["", "persistent::"]))],
		([user, tail, transport]) => {
			if (user.includes(":")) return true;
			const password = `S3CRET${tail}`;
			const remote = parsed(`${transport}https://${user}:${password}@host/o/n`);
			return (
				GitRemote.format(remote) === `${transport}https://${user}@host/o/n` &&
				!JSON.stringify(remote).includes("S3CRET") &&
				!GitRemote.format(GitRemote.redact(remote)).includes("S3CRET")
			);
		},
		{ arbitrary: { runs: 2000 } },
	);

	it.prop(
		"redact leaves no user or query text behind",
		[gitish, gitish],
		([user, query]) => {
			if (user.includes(":") || user.includes("@") || query.includes("@")) return true;
			const out = GitRemote.format(GitRemote.redact(parsed(`https://U${user}@host/o/n?Q${query}`)));
			return out === "https://<redacted>@host/o/n?<redacted>";
		},
		{ arbitrary: { runs: 1000 } },
	);
});

describe("GitRemote hardening — hostile input stays total and linear", () => {
	const SIZE = 200_000;
	const hostile: ReadonlyArray<readonly [string, string]> = [
		["unmatched [", "[".repeat(SIZE)],
		["unmatched [ then :", `${"[".repeat(SIZE)}:x`],
		["bracket pairs", "[]".repeat(SIZE)],
		["@[ runs", "@[".repeat(SIZE)],
		["@[ runs then :", `${"@[".repeat(SIZE)}:x`],
		["many @", `https://${"@".repeat(SIZE)}h/x`],
		["many :", ":".repeat(SIZE)],
		["many ::", `a${"::".repeat(SIZE)}`],
		["scheme-like run then ::", `${"a".repeat(SIZE)}::x`],
		["scheme-like run then ://", `${"a".repeat(SIZE)}://`],
		["scheme-like run, nothing after", "a".repeat(SIZE)],
		["many ://", "://".repeat(SIZE)],
		["many /", "/".repeat(SIZE)],
		["NUL and C0", "\0\u0001\u001b:\u0007/".repeat(SIZE / 8)],
	];
	for (const [label, raw] of hostile) {
		it(`${label}: returns without throwing, quickly`, () => {
			const started = performance.now();
			const result = GitRemote.parse(raw);
			const elapsed = performance.now() - started;
			if (Option.isSome(result) && !raw.includes("://")) assert.strictEqual(GitRemote.format(result.value), raw);
			assert.isBelow(elapsed, 500, `${label} took ${elapsed}ms`);
		});
	}

	/** Linear is ~4x from n to 4n; quadratic would be ~16x. A ratio, so hardware cancels. */
	const assertLinear = (make: (n: number) => string): void => {
		const time = (n: number): number => {
			const raw = make(n);
			const started = performance.now();
			for (let i = 0; i < 5; i++) GitRemote.parse(raw);
			return performance.now() - started;
		};
		time(50_000); // warm up
		const small = Math.max(time(100_000), 0.5);
		const large = time(400_000);
		assert.isBelow(large / small, 10, `100k=${small}ms 400k=${large}ms`);
	};

	it("scales linearly on unmatched brackets", () => assertLinear((n) => "[".repeat(n)));
	it("scales linearly on @[ runs (git's host_end search)", () => assertLinear((n) => `${"@[".repeat(n)}:x`));
	it("scales linearly on a scheme-character run (the transport probe)", () => assertLinear((n) => "a".repeat(n)));
	it("scales linearly on @ runs in a URL (the userinfo split)", () =>
		assertLinear((n) => `https://${"@".repeat(n)}h/x`));
});

describe("GitRemote — reproducing a persisted host/path key byte for byte (vitest-agent [persisted])", () => {
	// vitest-agent's canonicalizeGitUrl (sdk/src/utils/canonicalize-git-url.ts at
	// 1b61fcc6), copied as an ORACLE: the key it produced is stored on disk, so a
	// consumer moving onto GitRemote must reproduce it from the parts.
	const SCHEME_PREFIXES = ["git+ssh://", "git+https://", "ssh://", "https://", "http://"];
	const legacy = (raw: string): string | null => {
		const trimmed = raw.trim();
		if (trimmed.length === 0) return null;
		let value = trimmed;
		const prefix = SCHEME_PREFIXES.find((p) => value.startsWith(p));
		if (prefix !== undefined) {
			value = value.slice(prefix.length);
			const at = value.indexOf("@");
			const slash = value.indexOf("/");
			if (at !== -1 && (slash === -1 || at < slash)) value = value.slice(at + 1);
		} else {
			const ssh = value.match(/^(?:[\w.-]+@)?([\w.-]+):(.+)$/);
			if (ssh !== null) value = `${ssh[1]}/${ssh[2]}`;
		}
		if (value.endsWith(".git")) value = value.slice(0, -4);
		if (value.endsWith("/")) value = value.slice(0, -1);
		value = value.toLowerCase();
		if (value.length === 0 || !value.includes("/")) return null;
		const slash = value.indexOf("/");
		if (slash === 0 || slash === value.length - 1) return null;
		return value;
	};

	// The consumer-side composition: the parts, then the consumer's own steps 4-7.
	const FIVE = new Set(["git+ssh", "git+https", "ssh", "https", "http"]);
	const fromParts = (raw: string): string | null =>
		Option.match(GitRemote.parse(raw.trim()), {
			onNone: () => null,
			onSome: (remote) => {
				let value =
					remote._tag === "GitRemoteUrl" && FIVE.has(remote.scheme)
						? `${remote.host}${remote.port !== undefined ? `:${remote.port}` : ""}${remote.path}`
						: remote._tag === "GitRemoteScp"
							? `${remote.host}/${remote.path}`
							: remote._tag === "GitRemotePath"
								? remote.path
								: raw.trim();
				if (value.endsWith(".git")) value = value.slice(0, -4);
				if (value.endsWith("/")) value = value.slice(0, -1);
				value = value.toLowerCase();
				if (value.length === 0 || !value.includes("/")) return null;
				const slash = value.indexOf("/");
				if (slash === 0 || slash === value.length - 1) return null;
				return value;
			},
		});

	const reproduced = [
		// every input vitest-agent's own suite pins
		"git@github.com:spencerbeggs/vitest-agent.git",
		"https://github.com/spencerbeggs/vitest-agent.git",
		"https://github.com/spencerbeggs/vitest-agent",
		"ssh://git@github.com/spencerbeggs/vitest-agent.git",
		"https://GitHub.com/SpencerBeggs/Vitest-Agent",
		"git+https://github.com/foo/bar.git",
		"git+ssh://git@github.com/foo/bar.git",
		"http://example.com/foo/bar.git",
		"https://github.com/foo/bar/",
		"",
		"   ",
		"not-a-url",
		"https://",
		"github.com/foo/bar",
		"github.com/spencerbeggs/vitest-agent",
		// and the wider well-formed classes
		"ssh://git@github.com:22/o/n.git",
		"https://github.com/o/n.git/",
		"https://h/o/n?x=1",
		"ssh://[::1]/o/n",
		"https://host",
		"https://x-access-token:secret@github.com/o/n.git",
		"github:foo/bar",
		"gist:abc",
		"foo/bar",
		"./repo",
		"/srv/x",
		"C:/x/y",
		"git+http://h/o/n",
		"  git@github.com:O/N.git  ",
	];
	for (const raw of reproduced) {
		it(`reproduces ${JSON.stringify(raw)}`, () => {
			assert.strictEqual(fromParts(raw), legacy(raw));
		});
	}

	// Where the legacy key is a regex fall-through artifact, the parts give the
	// honest answer instead; the consumer holds the raw string for these.
	const artifacts: ReadonlyArray<readonly [string, string | null]> = [
		["git://github.com/o/n.git", "git///github.com/o/n"],
		["HTTPS://github.com/o/n", "https///github.com/o/n"],
		["file:///srv/r.git", "file////srv/r"],
		["https://u:p@ss@host/o/n", "ss@host/o/n"],
		["user+x@host:o/n", "user+x@host:o/n"],
	];
	for (const [raw, legacyKey] of artifacts) {
		it(`diverges only on the regex artifact ${JSON.stringify(raw)}`, () => {
			assert.strictEqual(legacy(raw), legacyKey);
			if (raw === "https://u:p@ss@host/o/n") assert.strictEqual(fromParts(raw), "host/o/n");
			if (raw === "user+x@host:o/n") assert.strictEqual(fromParts(raw), "host/o/n");
		});
	}
});

describe("GitRemote.redact — conservative whatever the form", () => {
	const redacted = (raw: string): string =>
		Option.match(GitRemote.parse(raw), {
			onNone: () => raw,
			onSome: (remote) => GitRemote.format(GitRemote.redact(remote)),
		});

	it("masks a mistyped credential URL that parses as a transport, scp or path form", () => {
		assert.strictEqual(redacted("https:://u:tok3n@github.com/o/r"), "https:://<redacted>@github.com/o/r");
		assert.strictEqual(redacted("https:/u:tok@h/r"), "https:/<redacted>@h/r");
		assert.strictEqual(redacted("https::tok:x@h"), "https::<redacted>@h");
		assert.strictEqual(redacted("https::tok@h"), "https::<redacted>@h");
		assert.strictEqual(redacted("//u:tok@h/r"), "//<redacted>@h/r");
	});

	it("leaves a credential-free path and scp path alone", () => {
		assert.strictEqual(redacted("/srv/r.git"), "/srv/r.git");
		assert.strictEqual(redacted("./a@b"), "./a@b");
		assert.strictEqual(redacted("host:o/n.git"), "host:o/n.git");
	});

	it("masks a free-text scheme after a transport's `::` (shrunk property counterexample)", () => {
		assert.strictEqual(redacted("https::S3CRET://@"), "https::<redacted>://<redacted>@");
		assert.isFalse(redacted("https::S3CRET://u@h").includes("S3CRET"));
		// Control: a well-known scheme behind a transport stays readable.
		assert.strictEqual(redacted("persistent::git+ssh://u@h/r"), "persistent::git+ssh://<redacted>@h/r");
	});

	const ALPHABET = ["a", "B", "1", ".", "-", "+", "_", "/", ":", "@", "[", "]", "?", "#", "\\", " ", "é"];
	const text = Arbitrary.array(Arbitrary.schema(Schema.Literals(ALPHABET)), { maxLength: 24 }).pipe(
		Arbitrary.map((chars) => chars.join("")),
	);
	const KNOWN = [
		"https://",
		"https:://",
		"https:/",
		"//",
		"https:",
		"persistent::https:/",
		"zz::",
		"ssh:/",
		"",
		"https::",
		"ext::",
		"git+ssh::",
		"a::https://",
		"https:///",
		"http:\\\\",
		":",
	];
	const head = Arbitrary.all([Arbitrary.schema(Schema.Literals(KNOWN)), text]).pipe(
		Arbitrary.map(([known, random]) => (random.length % 2 === 0 ? known : random)),
	);

	// A tail that often holds `://`, `//` or `/`: the shape that puts a free-text
	// scheme or a URL after a transport's `::`. Pure random text almost never does.
	const tailText = Arbitrary.all([
		Arbitrary.schema(Schema.Literals(["://", "//", "/", ":", "://x", "", "://u", "/x"])),
		text,
	]).pipe(Arbitrary.map(([known, random]) => (random.length % 2 === 0 ? known : random)));

	it.prop(
		"no user:secret@ survives redact, whatever form the value parses as",
		[head, text, tailText, text],
		([prefix, user, tail, rest]) => {
			if (user.includes("@") || rest.includes("@")) return true;
			return !redacted(`${prefix}${user}:S3CRET${tail}@${rest}`).includes("S3CRET");
		},
		{ arbitrary: { runs: 5000 } },
	);
});
