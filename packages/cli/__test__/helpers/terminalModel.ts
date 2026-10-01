const ESC = String.fromCharCode(0x1b);

/**
 * A small terminal model for production-path tests: what a terminal shows after `written`, as its non-empty lines.
 *
 * @remarks
 * It applies printable text, line feeds, and the erase and cursor moves Ink's log-update writes (erase line, cursor
 * up, cursor to column one); every other escape is ignored. Shared by the `clear` tests and the live view's.
 */
export const screenAfter = (written: string): ReadonlyArray<string> => {
	const lines: Array<string> = [""];
	let row = 0;
	let column = 0;
	const sequence = new RegExp(`${ESC}\\[([0-9;?]*)([A-Za-z])|${ESC}\\][^\\u0007]*\\u0007|([\\s\\S])`, "g");
	for (const match of written.matchAll(sequence)) {
		const [, params, command, character] = match;
		if (character !== undefined) {
			if (character === "\n") {
				row++;
				column = 0;
				while (lines.length <= row) lines.push("");
			} else if (character === "\r") column = 0;
			else if (character >= " ") {
				const line = lines[row] ?? "";
				lines[row] = `${line.slice(0, column).padEnd(column)}${character}${line.slice(column + 1)}`;
				column++;
			}
		} else if (command === "K") lines[row] = "";
		else if (command === "A") row = Math.max(0, row - Number(params === "" ? 1 : params));
		else if (command === "G") column = 0;
	}
	return lines.map((line) => line.trimEnd()).filter((line) => line !== "");
};
