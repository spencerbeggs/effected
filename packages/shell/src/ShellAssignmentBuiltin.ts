// An assignment builtin's arguments as bash reads them: `declare`, `typeset`,
// `local`, `export` and `readonly`, their options, their operands, and where
// their array values' keys become strings.

import { Option, Schema } from "effect";
import { ShellWord } from "./ShellWord.js";

/** The five builtins, and whether each reads `+` options (`declare +i`). */
const BUILTINS: ReadonlyMap<string, boolean> = new Map([
	["declare", true],
	["typeset", true],
	["local", true],
	["export", false],
	["readonly", false],
]);

/**
 * The options and operands of an assignment builtin, `declare`, `typeset`,
 * `local`, `export` or `readonly`, as bash reads them; `ShellCommand`'s
 * `assignmentBuiltin`.
 *
 * @remarks
 * `options` and `operands` are the command's `args`, split as the builtin's
 * `internal_getopt` splits them, after quote removal: options are the words
 * before the first operand that start `-` (or `+`, for `declare`, `typeset`
 * and `local`; `export +x` is an operand) and are more than that one
 * character. `--` ends the options and is in neither list; a lone `-` is the
 * first operand, as is the first word that is neither. So `declare y=1 -i`
 * has no option: bash assigns `y` and rejects `-i` as a name.
 *
 * `resolved` is `false` when a word in option position has no literal
 * (`declare "$o" y`, `declare -[i] y`): bash expands it before the builtin
 * reads options, so it may be an option or several, or vanish. It and every
 * word after it are then in `operands`, any of which may be an option, and a
 * guard must treat the options as unknown.
 *
 * `associativeFrom` is the index in `operands` from which bash reads an
 * array value's keys as strings rather than arithmetic, as an associative
 * array's. bash decides it by scanning the words as written, before
 * expansion and before the builtin parses options (`fix_assignment_words`):
 * every operand after a word whose text, with backslash-newlines removed,
 * starts `-` and holds an `A`. So `declare -x"A"`, `declare -- -A` and
 * `declare y=1 -A` mark the operands after them, though getopt reads no
 * `-A` option in the last two, while a quoted, escaped or expanded `-A`
 * (`"-A"`, `\-A`, `$o`), a `+A` and an `-A` after the value mark none, so
 * `declare "-A" x=([k]=1)` evaluates `k` as arithmetic. `None` when no
 * operand is marked, and always when the command word is not written bare
 * or a wrapper (`command declare`) runs it, since bash then scans nothing.
 *
 * @public
 */
export class ShellAssignmentBuiltin extends Schema.Class<ShellAssignmentBuiltin>("ShellAssignmentBuiltin")({
	builtin: Schema.Literals(["declare", "typeset", "local", "export", "readonly"]),
	options: Schema.Array(ShellWord),
	operands: Schema.Array(ShellWord),
	resolved: Schema.Boolean,
	associativeFrom: Schema.Option(Schema.Number),
}) {}

/**
 * Read an assignment builtin's arguments: `None` when `name` is not one of
 * the five. `word` is the command's name word as written, `args` the words
 * after it, and `wrapped` whether a wrapper ran it. Not exported from the
 * package; `ShellCommand.assignmentBuiltin` calls it.
 */
export const readAssignmentBuiltin = (
	name: string,
	word: ShellWord | undefined,
	args: ReadonlyArray<ShellWord>,
	wrapped: boolean,
): Option.Option<ShellAssignmentBuiltin> => {
	const plus = BUILTINS.get(name);
	if (plus === undefined) return Option.none();
	const options: Array<ShellWord> = [];
	let resolved = true;
	let first = 0;
	for (; first < args.length; first += 1) {
		const literal = (args[first] as ShellWord).literal;
		if (Option.isNone(literal)) {
			resolved = false;
			break;
		}
		const value = literal.value;
		if (value === "--") {
			first += 1;
			break;
		}
		if (value.length < 2 || (value[0] !== "-" && (!plus || value[0] !== "+"))) break;
		options.push(args[first] as ShellWord);
	}
	let associativeFrom: Option.Option<number> = Option.none();
	if (!wrapped && word?.joined === name) {
		// The arg after the first `-…A…` word, as an index into the operands.
		const marker = args.findIndex((arg) => {
			const text = arg.joined;
			return text.startsWith("-") && text.includes("A", 1);
		});
		if (marker !== -1) {
			const from = Math.max(marker + 1, first) - first;
			if (from < args.length - first) associativeFrom = Option.some(from);
		}
	}
	return Option.some(
		ShellAssignmentBuiltin.make({
			builtin: name as ShellAssignmentBuiltin["builtin"],
			options,
			operands: args.slice(first),
			resolved,
			associativeFrom,
		}),
	);
};
