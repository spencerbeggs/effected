// Grids of list-in-container shapes for the rules that read where micromark's list token ends (MD030) and how it
// reads blank quoted lines after a list (MD027): every container stack (blockquotes to three deep, footnotes, list
// items, and their mixes) by what separates the list from what follows (nothing, a blank line, a quoted blank line at
// each quote depth) by what follows (a list, a blockquote, a footnote, text, nothing) at each container level. A
// test pins each grid whole against markdownlint, so the model is held to a table, not a handful of examples.

import type { DifferentialInput } from "./differential.js";

interface Frame {
	/** The line that opens the frame, when it is not opened by its continuation prefix alone. */
	readonly open: string | undefined;
	/** The frame's continuation prefix. */
	readonly cont: string;
	readonly quote: boolean;
}

const quote: Frame = { open: undefined, cont: "> ", quote: true };
const footnote: Frame = { open: "[^1]: x", cont: "    ", quote: false };
const item: Frame = { open: "- p", cont: "  ", quote: false };

const prefix = (frames: ReadonlyArray<Frame>): string => frames.map((frame) => frame.cont).join("");

const opening = (stack: ReadonlyArray<Frame>): Array<string> =>
	stack.flatMap((frame, index) => (frame.open === undefined ? [] : [prefix(stack.slice(0, index)) + frame.open]));

/** MD030's grid: a two-item list in each container stack, then a separator, then the next block at each level. */
export const listEndGrid: ReadonlyArray<DifferentialInput> = (() => {
	const stacks: Record<string, ReadonlyArray<Frame>> = {
		q: [quote],
		qq: [quote, quote],
		qqq: [quote, quote, quote],
		f: [footnote],
		qf: [quote, footnote],
		fq: [footnote, quote],
		qi: [quote, item],
		qqi: [quote, quote, item],
		fqq: [footnote, quote, quote],
	};
	const grid: Array<DifferentialInput> = [];
	for (const [stackName, stack] of Object.entries(stacks)) {
		const full = prefix(stack);
		const body = [...opening(stack), `${full}- a`, `${full}- b`];
		const separators: Record<string, ReadonlyArray<string>> = { none: [], blank: [""] };
		stack.forEach((frame, index) => {
			if (frame.quote) separators[`quoted${index + 1}`] = [prefix(stack.slice(0, index + 1)).trimEnd()];
		});
		for (let level = 0; level <= stack.length; level++) {
			const at = prefix(stack.slice(0, level));
			for (const [separatorName, separator] of Object.entries(separators)) {
				for (const [kind, text] of [
					["list", "- c"],
					["quote", "> q"],
					["footnote", "[^2]: y"],
					["text", "text"],
					["none", undefined],
				] as const) {
					if (kind === "none" && level > 0) continue;
					const lines = [...body, ...separator, ...(text === undefined ? [] : [at + text])];
					grid.push({ name: `${stackName}/${separatorName}/${kind}@${level}`, source: `${lines.join("\n")}\n` });
				}
			}
		}
	}
	return grid;
})();

/** MD027's grid: a list in each container stack, a separator, a quoted line of spaces at each quote depth, then more. */
export const quotedBlankGrid: ReadonlyArray<DifferentialInput> = (() => {
	const stacks: Record<string, ReadonlyArray<Frame>> = {
		top: [],
		q: [quote],
		qq: [quote, quote],
		qqq: [quote, quote, quote],
		qi: [quote, item],
		iq: [item, quote],
		fq: [footnote, quote],
		qf: [quote, footnote],
		qiq: [quote, item, quote],
	};
	const grid: Array<DifferentialInput> = [];
	for (const [stackName, stack] of Object.entries(stacks)) {
		const full = prefix(stack);
		for (const [listName, list] of [
			["ul", ["- a"]],
			["ol", ["1. a"]],
			["nested", ["- a", "  - b"]],
		] as const) {
			const body = [...opening(stack), ...list.map((line) => full + line)];
			const separators: Record<string, ReadonlyArray<string>> = { none: [], blank: [""] };
			const depths: Array<number> = [];
			stack.forEach((frame, index) => {
				if (!frame.quote) return;
				separators[`q${index + 1}`] = [prefix(stack.slice(0, index + 1)).trimEnd()];
				depths.push(index + 1);
			});
			// A list in no blockquote: the quoted line of spaces opens a new one.
			if (depths.length === 0) depths.push(0);
			for (const [separatorName, separator] of Object.entries(separators)) {
				for (const depth of depths) {
					const marker = depth === 0 ? ">" : prefix(stack.slice(0, depth)).trimEnd();
					for (const [afterName, after] of [
						["end", []],
						["text", [`${marker} text`]],
						["item", [`${full}- c`]],
					] as const) {
						const lines = [...body, ...separator, `${marker}   `, ...after];
						grid.push({
							name: `${stackName}/${listName}/${separatorName}/spaces@${depth}/${afterName}`,
							source: `${lines.join("\n")}\n`,
						});
					}
				}
			}
		}
	}
	return grid;
})();
