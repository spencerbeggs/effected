import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { NpmrcEntry, npmrcValue, npmrcValues, parseNpmrc } from "../src/Npmrc.js";

/**
 * Milliseconds of CPU time this process has spent (`process.cpuUsage`, user plus system): time the work spent, not
 * time the process was descheduled, so a loaded machine can not stretch a sample. vitest runs each file in its own
 * fork, so no other test's CPU lands here. It under-measures async I/O, which the units here do not use.
 */
const cpuNow = (): number => {
	const used = process.cpuUsage();
	return (used.user + used.system) / 1000;
};

/** An npmrc env expression, `${name}`, spelled so no plain string literal carries a placeholder. */
const ref = (name: string, optional = ""): string => `$\{${name}${optional}}`;

const pairs = (text: string, env: Record<string, string> = {}): ReadonlyArray<readonly [string, string]> =>
	parseNpmrc(text, env).map((entry) => [entry.key, entry.value] as const);

describe("parseNpmrc lines", () => {
	it("reads typed entries in file order, skipping blanks and comments", () => {
		const entries = parseNpmrc(
			[
				"; a comment",
				"# another",
				"",
				"registry=https://mirror.example/",
				"@acme:registry = https://npm.acme.dev/",
			].join("\n"),
			{},
		);
		assert.deepStrictEqual(
			entries.map((entry) => entry.key),
			["registry", "@acme:registry"],
		);
		assert.isTrue(entries[0] instanceof NpmrcEntry);
		assert.strictEqual(entries[1]?.value, "https://npm.acme.dev/");
		assert.deepStrictEqual(entries[0]?.unset, []);
	});

	it("handles CRLF, a bare key as true, sections and quoted values", () => {
		assert.deepStrictEqual(pairs("a=1\r\nflag\r\n[sec]\r\nb=2\r\nq=\"a;b\"\r\ns='x#y'\r\nc=v ; tail"), [
			["a", "1"],
			["flag", "true"],
			["sec.b", "2"],
			["sec.q", "a;b"],
			["sec.s", "x#y"],
			["sec.c", "v"],
		]);
	});

	it("skips a leading BOM", () => {
		assert.deepStrictEqual(pairs("\uFEFFa=1\nb=2"), [
			["a", "1"],
			["b", "2"],
		]);
	});

	it("returns a repeated key each time", () => {
		assert.deepStrictEqual(pairs("a=1\na=2"), [
			["a", "1"],
			["a", "2"],
		]);
	});
});

describe("parseNpmrc env expansion", () => {
	it("expands a set variable in a value and in a key", () => {
		assert.deepStrictEqual(pairs(`//host/:_authToken=${ref("TOKEN")}\n${ref("K")}=v`, { TOKEN: "t0k", K: "name" }), [
			["//host/:_authToken", "t0k"],
			["name", "v"],
		]);
	});

	it("leaves an unset variable as written and records it in unset", () => {
		const [entry] = parseNpmrc(`token=${ref("NOPE")}-${ref("ALSO")}-${ref("SET")}`, { SET: "ok" });
		assert.strictEqual(entry?.value, [ref("NOPE"), ref("ALSO"), "ok"].join("-"));
		assert.deepStrictEqual(entry?.unset, ["NOPE", "ALSO"]);
	});

	it("empties an optional unset variable and does not record it", () => {
		const [entry] = parseNpmrc(`x=a${ref("NOPE", "?")}b`, {});
		assert.strictEqual(entry?.value, "ab");
		assert.deepStrictEqual(entry?.unset, []);
	});

	it("treats an odd run of backslashes as an escape and an even run as literal backslashes", () => {
		assert.deepStrictEqual(pairs(`a="\\\\${ref("V")}"\nb="\\\\\\\\${ref("V")}"`, { V: "val" }), [
			["a", ref("V")],
			["b", "\\val"],
		]);
	});

	it("expands a set optional variable", () => {
		assert.deepStrictEqual(pairs(`x=a${ref("SET", "?")}b`, { SET: "-" }), [["x", "a-b"]]);
	});

	it("records an unset variable in a key in unset, like one in a value", () => {
		const [entry] = parseNpmrc(`//${ref("HOST")}/:_authToken=${ref("TOK")}`, {});
		assert.strictEqual(entry?.key, `//${ref("HOST")}/:_authToken`);
		assert.deepStrictEqual(entry?.unset, ["HOST", "TOK"]);
	});

	it("honours an escape in a key", () => {
		const [entry] = parseNpmrc(`"\\${ref("K")}"=v`, { K: "name" });
		assert.strictEqual(entry?.key, ref("K"));
		assert.deepStrictEqual(entry?.unset, []);
	});

	it("ignores a prototype name that the environment does not own", () => {
		const [entry] = parseNpmrc(`x=${ref("constructor")}`, {});
		assert.strictEqual(entry?.value, ref("constructor"));
		assert.deepStrictEqual(entry?.unset, ["constructor"]);
	});
});

describe("parseNpmrc array settings", () => {
	it("returns key[]=v lines as array entries, in file order, with the [] removed", () => {
		const entries = parseNpmrc("ca[]=one\nregistry=r\nca[]=two\n[s]\nomit[]=dev", {});
		assert.deepStrictEqual(
			entries.map((entry) => [entry.key, entry.value, entry.array]),
			[
				["ca", "one", true],
				["registry", "r", false],
				["ca", "two", true],
				["s.omit", "dev", true],
			],
		);
	});

	it("reads a quoted key[] as an array, as ini does", () => {
		const [entry] = parseNpmrc('"ca[]"=a', {});
		assert.strictEqual(entry?.key, "ca");
		assert.isTrue(entry?.array);
	});

	it("agrees with the ini package npm uses", () => {
		// ini@6.0.0 parse("ca[]=a\nca[]=b\nregistry=r") => { ca: ["a", "b"], registry: "r" } (probed, not imported:
		// ini is not a dependency of this package).
		const entries = parseNpmrc("ca[]=a\nca[]=b\nregistry=r", {});
		assert.deepStrictEqual(npmrcValues(entries, "ca"), ["a", "b"]);
		assert.deepStrictEqual(npmrcValue(entries, "registry"), Option.some("r"));
	});

	it("answers npmrcValue None for a key set only as an array, and npmrcValues an empty list for an absent one", () => {
		const entries = parseNpmrc("ca[]=a", {});
		assert.isTrue(Option.isNone(npmrcValue(entries, "ca")));
		assert.deepStrictEqual(npmrcValues(entries, "ca"), ["a"]);
		assert.deepStrictEqual(npmrcValues(entries, "other"), []);
	});
});

describe("parseNpmrc on long input", () => {
	it("stays linear on many lines and on hostile runs", () => {
		const lines = Array.from({ length: 20_000 }, (_, i) => `k${i}=${ref("V")}`).join("\n");
		const start = cpuNow();
		assert.strictEqual(parseNpmrc(lines, { V: "x" }).length, 20_000);
		parseNpmrc(`x=${"\\".repeat(20_000)}${ref("V")}`, {});
		parseNpmrc(`x=${"${".repeat(20_000)}`, {});
		assert.isBelow(cpuNow() - start, 2_000);
	});
});

describe("npmrcValue", () => {
	const entries = parseNpmrc("a=1\nb=2\na=3", {});

	it("returns Some of the last occurrence", () => {
		assert.deepStrictEqual(npmrcValue(entries, "a"), Option.some("3"));
		assert.deepStrictEqual(npmrcValue(entries, "b"), Option.some("2"));
	});

	it("returns None for an absent key, including a prototype name", () => {
		assert.isTrue(Option.isNone(npmrcValue(entries, "c")));
		assert.isTrue(Option.isNone(npmrcValue(entries, "constructor")));
	});
});
