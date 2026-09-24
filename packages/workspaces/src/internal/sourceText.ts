// The one lexer behind SourceBoundary: a single pass that tells code from
// comments and literals, so a scanner looking for real references never trips
// on prose, a string, template text or a regex body — and never lets a "/*"
// inside a string swallow real code behind it.
//
// Deliberately NOT a parser. It tracks exactly what decides whether a
// character is code: comments, the three quote forms, template substitutions
// nested to any depth, and regex literals by the classic previous-token rule.
// Documented misreads: a regex literal directly after a block-closing `}`
// reads as division, and JSX text reads as code.

/** A string literal, or a template literal with no substitutions, as written in the source. */
export interface SourceLiteral {
	/** Offset of the opening quote. */
	readonly start: number;
	/** The characters between the quotes, escapes left as written. */
	readonly value: string;
}

/** One source text, split three ways. Both strings have the input's exact length and line breaks. */
export interface LexedSource {
	/** Comments blanked to spaces; every literal intact. */
	readonly withoutComments: string;
	/** Comments AND every literal's contents blanked: only code, plus quote and delimiter characters. */
	readonly code: string;
	/** Every string literal and substitution-free template literal, in source order. */
	readonly literals: ReadonlyArray<SourceLiteral>;
}

const IDENTIFIER = /[\p{ID_Continue}$\u200c\u200d]/u;
const SPACE = /\s/;
const FLAG = /[a-z]/i;

/** Keywords after which a `/` opens a regex literal rather than a division. */
const REGEX_AFTER = new Set([
	"return",
	"typeof",
	"instanceof",
	"in",
	"of",
	"new",
	"delete",
	"void",
	"throw",
	"case",
	"do",
	"else",
	"yield",
	"await",
]);

/** Objects a member access on which still reaches a global. */
const GLOBAL_OBJECTS = new Set(["globalThis", "global", "window", "self"]);

/** Whether `char` can continue an identifier. */
export const isIdentifierChar = (char: string | undefined): boolean => char !== undefined && IDENTIFIER.test(char);

/** Lex `text` once into its comment-free view, its code-only view and its literals. */
export const lex = (text: string): LexedSource => {
	const kept: Array<string> = [];
	const code: Array<string> = [];
	const literals: Array<SourceLiteral> = [];
	// One brace-depth counter per open template substitution, innermost last.
	const substitutions: Array<number> = [];
	const length = text.length;
	let i = 0;

	const blank = (char: string): string => (char === "\n" || char === "\r" ? char : " ");
	/** Emit one input character: `keep` for the comment-free view, `live` for the code view. */
	const emit = (char: string, keep: boolean, live: boolean): void => {
		kept.push(keep ? char : blank(char));
		code.push(live ? char : blank(char));
	};

	/** Whether a `/` here opens a regex, judged by the last code token. */
	const regexAllowed = (): boolean => {
		let j = code.length - 1;
		while (j >= 0 && SPACE.test(code[j] ?? "")) j--;
		if (j < 0) return true;
		const last = code[j] ?? "";
		if (isIdentifierChar(last)) {
			let start = j;
			while (start > 0 && isIdentifierChar(code[start - 1])) start--;
			return REGEX_AFTER.has(code.slice(start, j + 1).join(""));
		}
		return !")]}\"'`".includes(last);
	};

	/** Consume a regex literal at `i` if one closes on this line; `false` leaves `i` untouched. */
	const regex = (): boolean => {
		let j = i + 1;
		let inClass = false;
		for (; j < length; j++) {
			const char = text[j] ?? "";
			if (char === "\n" || char === "\r") return false;
			if (char === "\\") {
				j++;
				continue;
			}
			if (inClass) {
				if (char === "]") inClass = false;
			} else if (char === "[") {
				inClass = true;
			} else if (char === "/") {
				break;
			}
		}
		if (j >= length) return false;
		emit("/", true, true);
		for (let k = i + 1; k < j; k++) emit(text[k] ?? "", true, false);
		emit("/", true, true);
		i = j + 1;
		while (i < length && FLAG.test(text[i] ?? "")) {
			emit(text[i] ?? "", true, true);
			i++;
		}
		return true;
	};

	/** Consume a `"` or `'` string starting at `i`. An unterminated one stops at the line break. */
	const string = (quote: string): void => {
		const start = i;
		emit(quote, true, true);
		i++;
		while (i < length) {
			const char = text[i] ?? "";
			if (char === "\\") {
				emit(char, true, false);
				i++;
				if (i < length) {
					emit(text[i] ?? "", true, false);
					i++;
				}
				continue;
			}
			if (char === quote) {
				emit(char, true, true);
				i++;
				literals.push({ start, value: text.slice(start + 1, i - 1) });
				return;
			}
			if (char === "\n") return;
			emit(char, true, false);
			i++;
		}
	};

	/** Consume template text up to its closing backtick or the next `${`. */
	const templateText = (): "end" | "substitution" | "eof" => {
		while (i < length) {
			const char = text[i] ?? "";
			if (char === "\\") {
				emit(char, true, false);
				i++;
				if (i < length) {
					emit(text[i] ?? "", true, false);
					i++;
				}
				continue;
			}
			if (char === "`") {
				emit(char, true, true);
				i++;
				return "end";
			}
			if (char === "$" && text[i + 1] === "{") {
				emit("$", true, true);
				emit("{", true, true);
				i += 2;
				return "substitution";
			}
			emit(char, true, false);
			i++;
		}
		return "eof";
	};

	if (text.startsWith("#!")) {
		while (i < length && text[i] !== "\n") {
			emit(text[i] ?? "", false, false);
			i++;
		}
	}

	while (i < length) {
		const char = text[i] ?? "";
		const next = text[i + 1];
		if (char === "/" && next === "/") {
			while (i < length && text[i] !== "\n") {
				emit(text[i] ?? "", false, false);
				i++;
			}
		} else if (char === "/" && next === "*") {
			const close = text.indexOf("*/", i + 2);
			const end = close === -1 ? length : close + 2;
			while (i < end) {
				emit(text[i] ?? "", false, false);
				i++;
			}
		} else if (char === '"' || char === "'") {
			string(char);
		} else if (char === "`") {
			const start = i;
			emit(char, true, true);
			i++;
			const stop = templateText();
			if (stop === "end") literals.push({ start, value: text.slice(start + 1, i - 1) });
			else if (stop === "substitution") substitutions.push(0);
		} else if (char === "/" && regexAllowed() && regex()) {
			// consumed by regex()
		} else if (char === "{") {
			const depth = substitutions.at(-1);
			if (depth !== undefined) substitutions[substitutions.length - 1] = depth + 1;
			emit(char, true, true);
			i++;
		} else if (char === "}") {
			const depth = substitutions.at(-1);
			emit(char, true, true);
			i++;
			if (depth === 0) {
				substitutions.pop();
				if (templateText() === "substitution") substitutions.push(0);
			} else if (depth !== undefined) {
				substitutions[substitutions.length - 1] = depth - 1;
			}
		} else {
			emit(char, true, true);
			i++;
		}
	}
	return { withoutComments: kept.join(""), code: code.join(""), literals };
};

/**
 * Offsets where `name` is referenced in lexed `code` as a free identifier, a
 * member of a global object, or a spread operand. A member of any other object
 * (`child.process`), a longer identifier and a private field are not.
 */
export const references = (code: string, name: string): ReadonlyArray<number> => {
	const found: Array<number> = [];
	for (let at = code.indexOf(name); at !== -1; at = code.indexOf(name, at + name.length)) {
		const before = code[at - 1];
		if (isIdentifierChar(before) || before === "#" || isIdentifierChar(code[at + name.length])) continue;
		let j = at - 1;
		while (j >= 0 && SPACE.test(code[j] ?? "")) j--;
		if (code[j] !== ".") {
			found.push(at);
			continue;
		}
		if (code[j - 1] === "." && code[j - 2] === ".") {
			found.push(at);
			continue;
		}
		let end = code[j - 1] === "?" ? j - 2 : j - 1;
		while (end >= 0 && SPACE.test(code[end] ?? "")) end--;
		let start = end;
		while (start >= 0 && isIdentifierChar(code[start])) start--;
		if (GLOBAL_OBJECTS.has(code.slice(start + 1, end + 1))) found.push(at);
	}
	return found;
};

/** The identifier ending at or before `end` (skipping whitespace); `""` when it is itself a member access. */
const wordEndingAt = (code: string, end: number): string => {
	let j = end;
	while (j >= 0 && SPACE.test(code[j] ?? "")) j--;
	let start = j;
	while (start >= 0 && isIdentifierChar(code[start])) start--;
	return code[start] === "." ? "" : code.slice(start + 1, j + 1);
};

/**
 * The literals that are module specifiers: after `from` or `import`, or the
 * sole argument of `import(` or `require(`.
 */
export const specifierLiterals = (lexed: LexedSource): ReadonlyArray<SourceLiteral> =>
	lexed.literals.filter((literal) => {
		let j = literal.start - 1;
		while (j >= 0 && SPACE.test(lexed.code[j] ?? "")) j--;
		if (lexed.code[j] === "(") {
			const callee = wordEndingAt(lexed.code, j - 1);
			return callee === "import" || callee === "require";
		}
		const keyword = wordEndingAt(lexed.code, j);
		return keyword === "from" || keyword === "import";
	});

/** A lookup from an offset in `text` to its 1-based line and UTF-16 column. */
export const locate = (text: string): ((offset: number) => { readonly line: number; readonly column: number }) => {
	const starts: Array<number> = [0];
	for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
	return (offset) => {
		let low = 0;
		let high = starts.length - 1;
		while (low < high) {
			const middle = (low + high + 1) >> 1;
			if ((starts[middle] ?? 0) <= offset) low = middle;
			else high = middle - 1;
		}
		return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
	};
};
