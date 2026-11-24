// A grid of code spans for MD038, which reads a code span the way micromark tokenizes it (sequences, one space of
// padding each side when both sides are blank and there is data, data runs split at line endings): every backtick
// count by leading and trailing whitespace by core content, then line breaks inside the span, then the places a code
// span sits. A test pins the grid whole against markdownlint.

import type { DifferentialInput } from "./differential.js";

const blanks = ["", " ", "  ", "   ", "\t", " \t", "\t "];
const cores = ["x", "x y", "`", "x`", "`x", "``", " "];

export const codeSpanGrid: ReadonlyArray<DifferentialInput> = (() => {
	const grid: Array<DifferentialInput> = [];
	for (const fence of ["`", "``"]) {
		for (const core of cores) {
			for (const lead of blanks) {
				for (const trail of blanks) {
					grid.push({
						name: `${fence.length}/${JSON.stringify(lead)}${JSON.stringify(core)}${JSON.stringify(trail)}`,
						source: `text ${fence}${lead}${core}${trail}${fence} text\n`,
					});
				}
			}
		}
	}
	const lineBreaks: ReadonlyArray<readonly [string, string]> = [
		["break at start", "`\nx`"],
		["break at end", "`x\n`"],
		["break in middle", "`x\ny`"],
		["space and break at start", "` \nx`"],
		["break and space at start", "`\n x`"],
		["space and break at end", "`x \n`"],
		["two spaces, break, at start", "`  \nx`"],
		["break, then indented", "`x\n   y  `"],
		["blockquote break", "> `  x\n>  y`"],
		["blockquote break at end", "> `x\n> `"],
		["list item break", "- `x\n  y  `"],
		["list item break at start", "- `\n    x`"],
		["three lines", "`  a\nb\nc  `"],
		// A line ending as padding, on either side or both.
		["breaks both sides", "`\nx\n`"],
		["break and spaces both sides", "`\n  x  \n`"],
		["spaces then break both sides", "`  \nx\n  `"],
		["space-break-space", "` \n x \n `"],
		["break then backtick", "`\n`x\n`"],
		["quoted breaks both sides", "> `\n>  x \n> `"],
		["listed breaks both sides", "- `\n   x  \n  `"],
		["tab continuation", "`a\n\t b  `"],
		["two backticks, breaks", "``\n` x\n``"],
	];
	for (const [name, source] of lineBreaks) grid.push({ name, source: `${source}\n` });
	const places: ReadonlyArray<readonly [string, string]> = [
		["heading", "# a `  x` b\n"],
		["setext heading", "a ` x  `\n===\n"],
		["table cell", "| a | b |\n| - | - |\n| ` x` | `y ` |\n"],
		["table cell with pipe", "| a |\n| - |\n| ` x \\| y ` |\n"],
		["link text", "[`  x`](u)\n"],
		["image alt", "![` x `](u)\n"],
		["emphasis", "*`  x`* and **`y  `**\n"],
		["blockquote", "> ` x` and `y  `\n"],
		["nested list", "- a\n  - ` x`\n"],
		["footnote", "Text[^1]\n\n[^1]: ` x `\n"],
		["html line", "<b>` x`</b>\n"],
		["html block", "<div>\n` x`\n</div>\n"],
		["in math", "$$\n` x`\n$$\n"],
		["inline math beside", "$a$ ` x` $b$\n"],
		["escaped backtick", "\\` x`\n"],
		["unclosed", "` x\n"],
		["long", `\`  ${"word ".repeat(10)}\`\n`],
		["long end", `\`${"word ".repeat(10)}  \`\n`],
		["two spans", "` x` `y ` `z`\n"],
		["undefined reference", "[`  x`][undef]\n"],
		["front matter", "---\ntitle: x\n---\n` x`\n"],
		["CRLF", "` x`\r\n`y  `\r\n"],
		["CRLF break", "`  x\r\ny`\r\n"],
	];
	for (const [name, source] of places) grid.push({ name, source });
	return grid;
})();
