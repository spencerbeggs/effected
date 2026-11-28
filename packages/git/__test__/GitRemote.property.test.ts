import { describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Arbitrary, Option, Schema } from "effect";
import type { GitRemoteForm } from "../src/GitRemote.js";
import { GitRemote } from "../src/GitRemote.js";

const parsed = (raw: string): GitRemoteForm => Option.getOrThrow(GitRemote.parse(raw));

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
			arbitrary: { runs: Depth.pick({ sample: 200, full: 2000 }) },
		},
	);

	it.prop(
		"parse is total and round-trips for scheme- and transport-led strings",
		[schemed],
		([raw]) => roundTrips(raw),
		{
			arbitrary: { runs: Depth.pick({ sample: 200, full: 2000 }) },
		},
	);

	it.prop("parse is total and round-trips for arbitrary strings", [Schema.String], ([raw]) => roundTrips(raw), {
		arbitrary: { runs: Depth.pick({ sample: 100, full: 1000 }) },
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
		{ arbitrary: { runs: Depth.pick({ sample: 200, full: 2000 }) } },
	);

	it.prop(
		"redact leaves no user or query text behind",
		[gitish, gitish],
		([user, query]) => {
			if (user.includes(":") || user.includes("@") || query.includes("@")) return true;
			const out = GitRemote.format(GitRemote.redact(parsed(`https://U${user}@host/o/n?Q${query}`)));
			return out === "https://<redacted>@host/o/n?<redacted>";
		},
		{ arbitrary: { runs: Depth.pick({ sample: 100, full: 1000 }) } },
	);
});

describe("GitRemote.redact — conservative whatever the form, generated", () => {
	const redacted = (raw: string): string =>
		Option.match(GitRemote.parse(raw), {
			onNone: () => raw,
			onSome: (remote) => GitRemote.format(GitRemote.redact(remote)),
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
		{ arbitrary: { runs: Depth.pick({ sample: 500, full: 5000 }) } },
	);
});
