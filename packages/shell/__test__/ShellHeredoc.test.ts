import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import type { ShellHeredoc } from "../src/index.js";
import { ShellSyntax } from "../src/index.js";

const heredocs = (input: string): ReadonlyArray<ShellHeredoc> =>
	ShellSyntax.parse(input).segments.flatMap((segment) => segment.heredocs);

describe("heredocs", () => {
	it("attaches the body to the redirection that introduced it, with offsets", () => {
		const source = "cat <<EOF\nhello\nworld\nEOF\nnext";
		const script = ShellSyntax.parse(source);
		const [heredoc] = script.segments[0]?.heredocs ?? [];
		assert.isDefined(heredoc);
		if (heredoc === undefined) return;
		assert.strictEqual(heredoc.delimiter, "EOF");
		assert.isFalse(heredoc.quoted);
		assert.isTrue(heredoc.terminated);
		assert.strictEqual(heredoc.body, "hello\nworld\n");
		assert.strictEqual(source.slice(heredoc.start, heredoc.end), heredoc.body);
		assert.strictEqual(script.segments[1]?.words[0]?.raw, "next");
	});

	it("reads quoting anywhere in the delimiter word", () => {
		const delimiters = (input: string) => heredocs(input).map((h) => [h.delimiter, h.quoted]);
		assert.deepStrictEqual(delimiters("cat <<'EOF'\nx\nEOF"), [["EOF", true]]);
		assert.deepStrictEqual(delimiters('cat <<"EOF"\nx\nEOF'), [["EOF", true]]);
		assert.deepStrictEqual(delimiters("cat <<\\EOF\nx\nEOF"), [["EOF", true]]);
		assert.deepStrictEqual(delimiters("cat <<E'O'F\nx\nEOF"), [["EOF", true]]);
		assert.deepStrictEqual(delimiters("cat << EOF\nx\nEOF"), [["EOF", false]]);
	});

	it("does not split on operators inside the body", () => {
		const script = ShellSyntax.parse("cat <<'X'\na && b; c | d\nX\nls");
		assert.deepStrictEqual(
			script.segments.map((s) => s.words.map((w) => w.raw)),
			[["cat"], ["ls"]],
		);
	});

	it("consumes several pending bodies in order at one newline", () => {
		const found = heredocs("cat <<A <<-B && echo <<C\none\nA\n\ttwo\n\tB\nthree\nC\nafter");
		assert.deepStrictEqual(
			found.map((h) => [h.delimiter, h.body, h.stripTabs]),
			[
				["A", "one\n", false],
				["B", "\ttwo\n", true],
				["C", "three\n", false],
			],
		);
		assert.strictEqual(found[1]?.text, "two\n");
	});

	it("requires the delimiter line to match exactly", () => {
		const [heredoc] = heredocs("cat <<EOF\n EOF\nEOFX\nEOF");
		assert.strictEqual(heredoc?.body, " EOF\nEOFX\n");
	});

	it("only strips tabs from the delimiter line for <<-", () => {
		const [plain] = heredocs("cat <<EOF\n\tEOF\nEOF");
		assert.strictEqual(plain?.body, "\tEOF\n");
	});

	it("lists the expansions of an unquoted body, and none for a quoted one", () => {
		const [unquoted] = heredocs("cat <<EOF\n$HOME $(git push) \\$(not) `date`\nEOF");
		assert.deepStrictEqual(
			unquoted?.expansions.map((e) => e.raw),
			["$HOME", "$(git push)", "`date`"],
		);
		const [quoted] = heredocs("cat <<'EOF'\n$HOME $(git push)\nEOF");
		assert.lengthOf(quoted?.expansions ?? [], 0);
	});

	it("keeps a double quote literal in an unquoted body", () => {
		const [heredoc] = heredocs('cat <<EOF\nsay "$(echo hi)"\nEOF');
		assert.deepStrictEqual(
			heredoc?.expansions.map((e) => e.raw),
			["$(echo hi)"],
		);
	});

	it("records an unterminated body running to the end, with a diagnostic on the operator", () => {
		const script = ShellSyntax.parse("cat <<EOF\nnever closed");
		const [heredoc] = script.segments[0]?.heredocs ?? [];
		assert.isFalse(heredoc?.terminated);
		assert.strictEqual(heredoc?.body, "never closed");
		assert.deepStrictEqual(
			script.diagnostics.map((d) => [d.code, d.offset, d.length]),
			[["UnterminatedHeredoc", 4, 5]],
		);
	});

	it("records a heredoc whose command line never ends as an empty, unterminated body", () => {
		const script = ShellSyntax.parse("cat <<EOF");
		const [heredoc] = script.segments[0]?.heredocs ?? [];
		assert.strictEqual(heredoc?.body, "");
		assert.strictEqual(heredoc?.start, 9);
		assert.deepStrictEqual(
			script.diagnostics.map((d) => d.code),
			["UnterminatedHeredoc"],
		);
	});

	it("does not read <<< as a heredoc", () => {
		const script = ShellSyntax.parse("cat <<< EOF\nls");
		assert.lengthOf(heredocs("cat <<< EOF\nls"), 0);
		assert.strictEqual(script.segments[1]?.words[0]?.raw, "ls");
	});

	it("skips heredoc bodies inside a command substitution", () => {
		const script = ShellSyntax.parse("x=\"$(cat <<'EOF'\nit's ) here\nEOF\n)\" && echo done");
		assert.deepStrictEqual(
			script.segments.map((s) => s.words.map((w) => Option.getOrNull(w.literal))),
			[[], ["echo", "done"]],
		);
		const [substitution] = script.substitutions();
		assert.strictEqual(substitution?.body, "cat <<'EOF'\nit's ) here\nEOF\n");
	});
});

// Each expected value checked against GNU bash 5.3.20 (`cat <<E | od -c`):
// an unquoted body joins a backslash-newline before `<<-` strips the leading
// tabs of the joined line, and a quoted body keeps every backslash-newline.
describe("ShellHeredoc.joined", () => {
	const first = (input: string): ShellHeredoc => heredocs(input)[0] as ShellHeredoc;

	it("removes backslash-newlines from an unquoted body, as bash reads it", () => {
		const heredoc = first("cat <<E\na\\\nb $\\\n{x}\nE\n");
		assert.strictEqual(heredoc.body, "a\\\nb $\\\n{x}\n");
		assert.strictEqual(heredoc.joined, `ab \${x}\n`);
	});

	it("keeps them in a quoted body, where bash keeps them", () => {
		for (const input of ["cat <<'E'\na\\\nb\nE\n", 'cat <<"E"\na\\\nb\nE\n', "cat <<\\E\na\\\nb\nE\n"]) {
			assert.strictEqual(first(input).joined, "a\\\nb\n", input);
		}
	});

	it("keeps a newline after an escaped backslash, and other escapes as written", () => {
		// `\\⏎` is a backslash and then a line break; `\$` stays as written.
		assert.strictEqual(first("cat <<E\nc\\\\\nd \\$x\nE\n").joined, "c\\\\\nd \\$x\n");
		assert.strictEqual(first("cat <<E\nc\\\\\\\nd\nE\n").joined, "c\\\\d\n");
	});

	it("strips <<- tabs from each joined line of an unquoted body, keeping a continued line's tabs", () => {
		const heredoc = first("cat <<-E\n\tA\\\n\tB\n\tC\nE\n");
		assert.strictEqual(heredoc.joined, "A\tB\nC\n");
		// `text` strips each physical line, as bash does for a quoted body.
		assert.strictEqual(heredoc.text, "A\\\nB\nC\n");
		assert.strictEqual(first("cat <<-'E'\n\tA\\\n\tB\nE\n").joined, "A\\\nB\n");
	});

	it("strips <<- tabs only after a line feed, never after a carriage return", () => {
		// bash's line is LF-terminated; JavaScript's `^` in multiline mode also
		// matches after `\r`.
		const heredoc = first("cat <<-E\nx\r\ty\n\tz\nE\n");
		assert.strictEqual(heredoc.text, "x\r\ty\nz\n");
		assert.strictEqual(heredoc.joined, "x\r\ty\nz\n");
	});

	it("is the body unchanged with no continuation, and empty for an empty body", () => {
		assert.strictEqual(first("cat <<E\nplain $x\nE\n").joined, "plain $x\n");
		assert.strictEqual(first("cat <<E\nE\n").joined, "");
		const unterminated = first("cat <<E\nrest\\");
		assert.isFalse(unterminated.terminated);
		assert.strictEqual(unterminated.joined, "rest\\");
	});
});
