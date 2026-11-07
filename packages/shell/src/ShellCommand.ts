// Resolving a segment to the command it runs: skip the leading words that do
// not name a command (reserved words, compound-command heads, assignments),
// unwrap the wrappers that run another command, and read the command name
// only when it is a literal.

import { Option, Schema } from "effect";
import { SHELL_RESERVED_WORDS, removeContinuations } from "./internal/raw.js";
import { ShellSegment } from "./ShellSegment.js";
import { ShellWord } from "./ShellWord.js";

interface WrapperSpec {
	/** Short options that take an argument. */
	readonly short: string;
	/** Long options (without `--`) that take an argument when written without `=`. */
	readonly long: ReadonlySet<string>;
	/** Short options after which the command cannot be read statically. */
	readonly stopShort: string;
	readonly stopLong: ReadonlySet<string>;
	/** Short options that make the wrapper itself the command (it runs nothing). */
	readonly keepShort: string;
	/**
	 * Which `NAME=value` words are skipped before the command: `"argv"` tests
	 * the word after quote removal, as `env` and `sudo` read their argv;
	 * `"shell"` tests the unquoted source, as the shell reads an assignment
	 * after the `time` reserved word.
	 */
	readonly assignments: "none" | "argv" | "shell";
	/** Whether a lone `-` is an option. */
	readonly dashAlone: boolean;
}

const none: ReadonlySet<string> = new Set();

const WRAPPERS: ReadonlyMap<string, WrapperSpec> = new Map<string, WrapperSpec>([
	[
		"sudo",
		{
			short: "ugChpDrtTUR",
			long: new Set([
				"user",
				"group",
				"close-from",
				"host",
				"prompt",
				"chdir",
				"role",
				"type",
				"command-timeout",
				"other-user",
				"chroot",
			]),
			stopShort: "",
			stopLong: none,
			keepShort: "",
			assignments: "argv",
			dashAlone: false,
		},
	],
	[
		"env",
		{
			short: "uC",
			long: new Set(["unset", "chdir"]),
			stopShort: "S",
			stopLong: new Set(["split-string"]),
			keepShort: "",
			assignments: "argv",
			dashAlone: true,
		},
	],
	[
		"command",
		{ short: "", long: none, stopShort: "", stopLong: none, keepShort: "vV", assignments: "none", dashAlone: false },
	],
	[
		"exec",
		{ short: "a", long: none, stopShort: "", stopLong: none, keepShort: "", assignments: "none", dashAlone: false },
	],
	[
		"nohup",
		{ short: "", long: none, stopShort: "", stopLong: none, keepShort: "", assignments: "none", dashAlone: false },
	],
	[
		"time",
		{
			short: "fo",
			long: new Set(["format", "output"]),
			stopShort: "",
			stopLong: none,
			keepShort: "",
			assignments: "shell",
			dashAlone: false,
		},
	],
]);

const RESERVED: ReadonlySet<string> = new Set(SHELL_RESERVED_WORDS);

/** Words that open a compound command, after which `coproc NAME` names the coprocess. */
const COMPOUND_HEADS: ReadonlySet<string> = new Set(["{", "if", "while", "until", "for", "select", "case", "[["]);

/**
 * The word's text when it is one bare, unescaped part: the only form in
 * which the shell recognizes a reserved word.
 */
const keyword = (word: ShellWord | undefined): string | undefined => {
	if (word === undefined) return undefined;
	const [only, ...rest] = word.parts;
	if (only === undefined || rest.length > 0 || only.kind !== "bare" || removeContinuations(only.raw) !== only.value)
		return undefined;
	return only.value;
};

/** The arithmetic command `((…))`: a whole word that runs no command. */
const isArithmeticCommand = (word: ShellWord | undefined): boolean => {
	const [only, ...rest] = word?.parts ?? [];
	return only !== undefined && rest.length === 0 && only.kind === "arithmetic" && only.command;
};

const startsCompound = (word: ShellWord | undefined): boolean => {
	const value = keyword(word);
	return (value !== undefined && COMPOUND_HEADS.has(value)) || isArithmeticCommand(word);
};

/**
 * An assignment as the shell reads one in prefix position, for a word the
 * lexer read outside command position (`time`'s GNU options, say): an unquoted
 * `NAME=` or `NAME[…]=`, once its backslash-newlines are gone. The lexer's own
 * command-position words reach `ShellSegment.assignments` and never come here.
 */
const SHELL_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/;
const isShellAssignment = (word: ShellWord): boolean => SHELL_ASSIGNMENT.test(removeContinuations(word.raw));

/** An assignment as `env` and `sudo` read their argv, after quote removal. */
const ARGV_ASSIGNMENT = /^[^=-][^=]*=/;

/**
 * The literal text a word starts with, after quote removal, up to its first
 * part the shell would expand. The whole word when it is literal.
 */
const literalPrefix = (word: ShellWord): string => {
	let prefix = "";
	for (const part of word.parts) {
		if (part.kind === "bare" || part.kind === "singleQuoted" || part.kind === "ansiC") prefix += part.value;
		else if (part.kind === "doubleQuoted" && part.expansions.length === 0) prefix += part.value;
		else break;
	}
	return prefix;
};

/** The last path segment: `/usr/bin/env` is `env`. */
const basename = (name: string): string => name.slice(name.lastIndexOf("/") + 1);

/**
 * Skip, from `from`, the words before a command name that do not name one:
 * reserved words, `[[ … ]]`, the arithmetic command `((…))`, the heads of
 * `for NAME`, `select NAME`, `function NAME` and `coproc NAME`, and
 * assignments. The shell lets a compound command's closing word be followed
 * directly by `then`, `do` or `{`, so `if [[ -n x ]] then git commit; fi`
 * is one segment whose command is `git`.
 */
const skipPrefix = (words: ReadonlyArray<ShellWord>, from: number): number => {
	let index = from;
	while (index < words.length) {
		const word = words[index] as ShellWord;
		const value = keyword(word);
		if (value === "[[") {
			let close = index + 1;
			while (close < words.length && keyword(words[close]) !== "]]") close += 1;
			if (close === words.length) return index;
			index = close + 1;
			continue;
		}
		if (value === "for" || value === "select") {
			if (isArithmeticCommand(words[index + 1])) {
				index += 2;
				continue;
			}
			const after = keyword(words[index + 2]);
			if (words[index + 1] !== undefined && (after === "do" || after === "{")) {
				index += 2;
				continue;
			}
			return index;
		}
		if (value === "function") {
			index += 2;
			continue;
		}
		if (value === "coproc") {
			index += 1;
			if (!startsCompound(words[index]) && startsCompound(words[index + 1])) index += 1;
			continue;
		}
		if ((value !== undefined && RESERVED.has(value)) || isArithmeticCommand(word)) {
			index += 1;
			continue;
		}
		if (isShellAssignment(word)) {
			index += 1;
			continue;
		}
		return index;
	}
	return words.length;
};

type Step =
	| { readonly kind: "next"; readonly index: number }
	| { readonly kind: "unknown"; readonly index: number }
	| { readonly kind: "keep" };

/** Skip a wrapper's options (and, for `sudo`/`env`, its assignments) from `index`. */
const skipOptions = (words: ReadonlyArray<ShellWord>, from: number, spec: WrapperSpec): Step => {
	let index = from;
	let options = true;
	while (index < words.length) {
		const word = words[index] as ShellWord;
		if (spec.assignments === "shell" && isShellAssignment(word)) {
			index += 1;
			continue;
		}
		// `env B=$X git`: the shell expands the value, but `B=` is literal, so
		// `env` still reads an assignment.
		if (spec.assignments === "argv" && ARGV_ASSIGNMENT.test(literalPrefix(word))) {
			index += 1;
			continue;
		}
		const literal = word.literal;
		// A word with no literal ends resolution at it: the caller reports no name.
		if (Option.isNone(literal)) return { kind: "next", index };
		const value = literal.value;
		if (options && value.startsWith("-")) {
			if (value === "--") {
				// `env -- FOO=1 git` still reads `FOO=1` as an assignment.
				options = false;
				index += 1;
				continue;
			}
			if (value === "-") {
				if (!spec.dashAlone) return { kind: "next", index };
				index += 1;
				continue;
			}
			if (value.startsWith("--")) {
				const equals = value.indexOf("=");
				const name = equals === -1 ? value.slice(2) : value.slice(2, equals);
				if (spec.stopLong.has(name)) return { kind: "unknown", index };
				index += equals === -1 && spec.long.has(name) ? 2 : 1;
				continue;
			}
			let consumed = 1;
			for (let k = 1; k < value.length; k += 1) {
				const option = value[k] as string;
				if (spec.stopShort.includes(option)) return { kind: "unknown", index };
				if (spec.keepShort.includes(option)) return { kind: "keep" };
				if (spec.short.includes(option)) {
					if (k === value.length - 1) consumed = 2;
					break;
				}
			}
			index += consumed;
			continue;
		}
		return { kind: "next", index };
	}
	return { kind: "next", index };
};

/**
 * The command a segment runs, resolved from its words.
 *
 * @remarks
 * `name` is the literal command name after the words that name no command
 * are skipped (see {@link ShellCommand.reservedWords}) and wrappers
 * unwrapped, and `args` are the words after it. `wrappers` lists the wrapper
 * commands unwrapped on the way, outermost first, as written, so
 * `sudo env FOO=1 git commit` resolves to `git` with `wrappers`
 * `["sudo", "env"]`.
 *
 * Two shapes resolve to `None`, and a guard must tell them apart by `args`:
 *
 * - **No command at all**, with no args: a segment with no words, or only
 *   words that run nothing, such as `fi`, `}`, `done`, `(( x > 1 ))` or the
 *   assignments of `FOO=$(cmd)`. Any substitution inside one is still listed
 *   by `ShellScript.substitutions`.
 * - **A command the analyzer cannot name**, with `args` the words from the
 *   one resolution stopped at, inclusive: a command word with no literal
 *   (`$GIT commit` gives the args `$GIT`, `commit`), or an `env -S` string.
 *
 * `name` is the word as written: `/usr/bin/git` stays `/usr/bin/git`, so
 * compare its last path segment. Wrappers are matched by that segment, so
 * `/usr/bin/env git` unwraps. Commands that take a command string
 * (`bash -c`, `eval`, `xargs`, `find -exec`) are reported as their own name.
 *
 * @public
 */
export class ShellCommand extends Schema.Class<ShellCommand>("ShellCommand")({
	segment: ShellSegment,
	name: Schema.Option(Schema.String),
	args: Schema.Array(ShellWord),
	wrappers: Schema.Array(Schema.String),
}) {
	/**
	 * The wrapper commands {@link ShellCommand.fromSegment} unwraps.
	 *
	 * @remarks
	 * `sudo` (with its option arguments and `NAME=value` words), `env` (`-i`,
	 * `-`, `-u NAME`, `-C DIR`, the long forms and `NAME=value` words),
	 * `command` (`-p`), `exec` (`-a NAME`, `-c`, `-l`), `nohup` and `time`
	 * (`-p`, GNU `time`'s `-f`, `-o`, `-a`, `-v`, and unquoted assignments,
	 * since `time` is a reserved word). A `NAME=value` word counts after
	 * quote removal for `env` and `sudo`, as they read their argv, so
	 * `env "FOO=a b" git` unwraps to `git`; a quoted option (`env "-i"`) is
	 * an option too. A wrapper is recognized by its last path segment, so
	 * `/usr/bin/env` unwraps. `command -v` and
	 * `command -V` only look a name up, so they do not unwrap: the command is
	 * `command`. `env -S` splits a string into a command line, which is not
	 * modelled, so resolution stops with no name. Other wrappers (`nice`,
	 * `xargs`, `timeout`, `stdbuf`) are reported as the command.
	 */
	static readonly wrapperNames: ReadonlyArray<string> = [...WRAPPERS.keys()];

	/**
	 * The reserved words skipped before a command name.
	 *
	 * @remarks
	 * `!`, `{`, `}`, `if`, `then`, `elif`, `else`, `fi`, `do`, `done`,
	 * `while`, `until`, `esac` and `coproc`, recognized only when written
	 * bare. They precede (or close around) a command, so skipping them finds
	 * the command in `if git diff --quiet; then git commit; fi`.
	 *
	 * Also skipped, because the shell lets a compound command's closing word
	 * run straight into `then`, `do` or `{`: a whole `[[ … ]]`, the arithmetic
	 * command `((…))`, `for NAME` and `select NAME` when `do` or `{` follows
	 * (and `for ((…))`), `function NAME`, the `NAME` of `coproc NAME` before a
	 * compound command, and unquoted assignments after any of these. So
	 * `if [[ -n x ]] then FOO=1 git commit; fi` resolves to `git`. A
	 * `for NAME in WORDS` list and a `case WORD in` head name no command and
	 * are reported as `for` and `case`.
	 */
	static readonly reservedWords: ReadonlyArray<string> = SHELL_RESERVED_WORDS;

	/**
	 * Resolve the command a segment runs.
	 *
	 * @example
	 * ```ts
	 * import { ShellCommand, ShellSyntax } from "@effected/shell";
	 * import { Option } from "effect";
	 *
	 * const [segment] = ShellSyntax.parse("sudo -u root FOO=1 git commit -m wip").segments;
	 * const command = ShellCommand.fromSegment(segment!);
	 * console.log(Option.getOrUndefined(command.name), command.wrappers);
	 * // => git [ 'sudo' ]
	 * ```
	 *
	 * @param segment - The segment to resolve.
	 * @returns The resolved command; pure and total.
	 */
	static fromSegment(segment: ShellSegment): ShellCommand {
		const words = segment.words;
		const wrappers: Array<string> = [];
		const resolved = (name: Option.Option<string>, args: ReadonlyArray<ShellWord>): ShellCommand =>
			ShellCommand.make({ segment, name, args, wrappers });
		let index = skipPrefix(words, 0);
		for (;;) {
			const word = words[index];
			if (word === undefined) return resolved(Option.none(), []);
			const literal = word.literal;
			if (Option.isNone(literal)) return resolved(Option.none(), words.slice(index));
			const spec = WRAPPERS.get(basename(literal.value));
			if (spec === undefined) return resolved(literal, words.slice(index + 1));
			const step = skipOptions(words, index + 1, spec);
			if (step.kind === "keep") return resolved(literal, words.slice(index + 1));
			wrappers.push(literal.value);
			if (step.kind === "unknown") return resolved(Option.none(), words.slice(step.index));
			// `time` is a reserved word timing a whole pipeline: `time { git commit; }`.
			index = basename(literal.value) === "time" ? skipPrefix(words, step.index) : step.index;
		}
	}
}
