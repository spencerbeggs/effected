import { describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Arbitrary, Schema } from "effect";
import { GitCommand } from "../src/GitCommand.js";
import { MISTYPED_PREFIXES as PREFIXES } from "./mistypedSchemes.js";

describe("GitCommand redaction — the form-independent credential backstop, generated", () => {
	const redacted = (value: string): string => GitCommand.fetch(value, "main").redactedArgs[1] ?? "";

	const ALPHABET = ["a", "B", "1", ".", "-", "+", "_", "/", ":", "@", "[", "]", "?", "#", "\\", " ", "é"];
	const text = Arbitrary.array(Arbitrary.schema(Schema.Literals(ALPHABET)), { maxLength: 24 }).pipe(
		Arbitrary.map((chars) => chars.join("")),
	);
	const prefix = Arbitrary.all([
		Arbitrary.schema(
			Schema.Literals([...PREFIXES, "https::", "ext::", "git+ssh::", "a::https://", "zz::", "persistent::https:/"]),
		),
		text,
	]).pipe(Arbitrary.map(([known, random]) => `${random.length % 2 === 0 ? known : random}`));
	// A tail that often holds `://`, `//` or `/`: the shape that puts a free-text
	// scheme or a URL after a transport's `::`. Pure random text almost never does.
	const tailText = Arbitrary.all([
		Arbitrary.schema(Schema.Literals(["://", "//", "/", ":", "://x", "", "://u", "/x"])),
		text,
	]).pipe(Arbitrary.map(([known, random]) => (random.length % 2 === 0 ? known : random)));

	it.prop(
		"no user:secret@ survives in redactedArgs, whatever surrounds it",
		[prefix, text, tailText, text],
		([head, user, tail, rest]) => {
			if (user.includes("@") || rest.includes("@")) return true;
			const value = `${head}${user}:S3CRET${tail}@${rest}`;
			return !redacted(value).includes("S3CRET");
		},
		{ arbitrary: { runs: Depth.pick({ sample: 5_000, full: 50_000 }) } },
	);
});
