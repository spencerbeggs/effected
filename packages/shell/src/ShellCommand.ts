// Resolving a segment to the command it runs: skip the leading words that do
// not name a command (reserved words, compound-command heads, assignments),
// unwrap the wrappers that run another command, and read the command name
// only when it is a literal.

import { Option, Schema } from "effect";
import { SHELL_RESERVED_WORDS, removeContinuations } from "./internal/raw.js";
import type { ShellAssignmentBuiltin } from "./ShellAssignmentBuiltin.js";
import { readAssignmentBuiltin } from "./ShellAssignmentBuiltin.js";
import { ShellSegment } from "./ShellSegment.js";
import { ShellWord } from "./ShellWord.js";

interface WrapperSpec {
	/** Short options that take an argument, attached or as the next word. */
	readonly short: string;
	/** Short options that take none. */
	readonly flags: string;
	/** Long options (without `--`) that take an argument, after `=` or as the next word. */
	readonly long: ReadonlySet<string>;
	/** Long options that take none, or only an optional one written after `=`. */
	readonly longFlags: ReadonlySet<string>;
	/** Short options after which the command cannot be read statically. */
	readonly stopShort: string;
	readonly stopLong: ReadonlySet<string>;
	/** Short options that make the wrapper itself the command (it runs nothing). */
	readonly keepShort: string;
	/**
	 * Which `NAME=value` words are skipped before the command:
	 *
	 * - `"env"`: `env`'s argv after quote removal. Options are read only up to
	 *   `--` or the first word that is not one; from there every word holding
	 *   an `=` is an assignment, so `env -- -x=1 git` and `env =x git` run
	 *   `git`, while in `env A=1 -i git` the `-i` is the command.
	 * - `"sudo"`: `sudo`'s argv after quote removal, read as `parse_args.c`'s
	 *   `is_envar` and `got_end_of_args` read it. A word holding an `=` whose
	 *   first character is neither `/` nor `=` is an assignment, wherever it
	 *   sits among the options, unless the argv word right before it is
	 *   exactly `--`, an option's value included. So `sudo /opt/x=1/git`,
	 *   `sudo =x`, `sudo -- A=1` and `sudo -p -- A=1` run that word, while
	 *   `sudo A=1 -u root git`, `sudo ./g=1 git` and `sudo -p-- A=1 git` run
	 *   `git`. A word before it that may expand to `--` names no command.
	 * - `"shell"`: the unquoted source, as the shell reads an assignment after
	 *   the `time` reserved word.
	 *
	 * For `env` and `sudo`, an assignment word that may not reach the wrapper
	 * as one argv word (`env A=$v git`) names no command, since bash may split
	 * it into an assignment and the command.
	 */
	readonly assignments: "none" | "env" | "sudo" | "shell";
	/** Whether a lone `-` is an option, skipped without ending the options. */
	readonly dashAlone: boolean;
}

const none: ReadonlySet<string> = new Set();

// Each table is the union of the implementations a command string may meet,
// so that no option is read as taking no argument when one of them takes
// one: an option missing from a table resolves to no name rather than to the
// word after it. Long options resolve by unique prefix, as `getopt_long`
// reads them.
const WRAPPERS: ReadonlyMap<string, WrapperSpec> = new Map<string, WrapperSpec>([
	[
		// sudo 1.9 (`parse_args.c`: `+Aa:BbC:c:D:Eeg:Hh::iKklNnPp:R:r:SsT:t:U:u:Vv`).
		// `-h` takes the next word as a host when it does not start `-`.
		"sudo",
		{
			short: "aCcDghpRrTtUu",
			flags: "ABbEeHiKklNnPSsVv",
			long: new Set([
				"auth-type",
				"close-from",
				"login-class",
				"chdir",
				"group",
				"host",
				"prompt",
				"chroot",
				"role",
				"type",
				"command-timeout",
				"other-user",
				"user",
			]),
			longFlags: new Set([
				"askpass",
				"background",
				"bell",
				"preserve-env",
				"edit",
				"set-home",
				"help",
				"login",
				"remove-timestamp",
				"reset-timestamp",
				"list",
				"non-interactive",
				"no-update",
				"preserve-groups",
				"stdin",
				"shell",
				"version",
				"validate",
			]),
			stopShort: "",
			stopLong: none,
			keepShort: "",
			assignments: "sudo",
			dashAlone: false,
		},
	],
	[
		// GNU coreutils 9.x (`-a`/`--argv0` is new in 9.x), with BSD env's `-P`
		// and FreeBSD's `-L` and `-U`, which take an argument.
		"env",
		{
			short: "aCuPLU",
			flags: "i0v",
			long: new Set(["argv0", "chdir", "unset", "env0-from"]),
			longFlags: new Set([
				"ignore-environment",
				"null",
				"block-signal",
				"default-signal",
				"ignore-signal",
				"list-signal-handling",
				"debug",
				"help",
				"version",
			]),
			stopShort: "S",
			stopLong: new Set(["split-string"]),
			keepShort: "",
			assignments: "env",
			dashAlone: true,
		},
	],
	[
		// The bash builtin: `command [-pVv]`.
		"command",
		{
			short: "",
			flags: "p",
			long: none,
			longFlags: none,
			stopShort: "",
			stopLong: none,
			keepShort: "vV",
			assignments: "none",
			dashAlone: false,
		},
	],
	[
		// The bash builtin: `exec [-cl] [-a name]`.
		"exec",
		{
			short: "a",
			flags: "cl",
			long: none,
			longFlags: none,
			stopShort: "",
			stopLong: none,
			keepShort: "",
			assignments: "none",
			dashAlone: false,
		},
	],
	[
		// GNU nohup takes only `--help` and `--version`; BSD nohup only `--`.
		"nohup",
		{
			short: "",
			flags: "",
			long: none,
			longFlags: new Set(["help", "version"]),
			stopShort: "",
			stopLong: none,
			keepShort: "",
			assignments: "none",
			dashAlone: false,
		},
	],
	[
		// The bash reserved word (`-p`), GNU time 1.9 (`+af:o:pqvV`, with
		// `--format`, `--output`, `--append`, `--portability`, `--quiet`,
		// `--verbose`) and BSD time (`ahlo:p`).
		"time",
		{
			short: "fo",
			flags: "ahlpqvV",
			long: new Set(["format", "output"]),
			longFlags: new Set(["append", "help", "portability", "quiet", "verbose", "version"]),
			stopShort: "",
			stopLong: none,
			keepShort: "",
			assignments: "shell",
			dashAlone: false,
		},
	],
]);

type LongOption = "argument" | "flag" | "stop" | "unknown";

/**
 * A long option name as `getopt_long` resolves it: an exact match wins, then
 * a unique prefix of one known name. No match, or a prefix of more than one
 * name, is `"unknown"`: the tool rejects it, and the analyzer cannot tell
 * whether it would have taken an argument.
 */
const longOption = (spec: WrapperSpec, name: string): LongOption => {
	const kind = (option: string): LongOption =>
		spec.stopLong.has(option) ? "stop" : spec.long.has(option) ? "argument" : "flag";
	if (spec.stopLong.has(name) || spec.long.has(name) || spec.longFlags.has(name)) return kind(name);
	let found: string | undefined;
	for (const set of [spec.stopLong, spec.long, spec.longFlags]) {
		for (const option of set) {
			if (!option.startsWith(name)) continue;
			if (found !== undefined) return "unknown";
			found = option;
		}
	}
	return found === undefined || name === "" ? "unknown" : kind(found);
};

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

/** `"[["` for a bare `[[` word, `"(("` for an arithmetic command, else `undefined`. */
const conditionalName = (word: ShellWord | undefined): "[[" | "((" | undefined =>
	keyword(word) === "[[" ? "[[" : isArithmeticCommand(word) ? "((" : undefined;

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
 * Skip, from `from`, the words before a command name that do not name one,
 * pushing the words of every `[[ … ]]` and `((…))` among them to `evaluated`:
 * reserved words, `[[ … ]]`, the arithmetic command `((…))`, the heads of
 * `for NAME`, `select NAME`, `function NAME` and `coproc NAME`, and
 * assignments. The shell lets a compound command's closing word be followed
 * directly by `then`, `do` or `{`, so `if [[ -n x ]] then git commit; fi`
 * is one segment whose command is `git`.
 */
const skipPrefix = (words: ReadonlyArray<ShellWord>, from: number, evaluated: Array<ShellWord>): number => {
	let index = from;
	while (index < words.length) {
		const word = words[index] as ShellWord;
		const value = keyword(word);
		if (value === "[[") {
			let close = index + 1;
			while (close < words.length && keyword(words[close]) !== "]]") close += 1;
			// An unclosed `[[` is the command: it and every word after it are its test.
			evaluated.push(...words.slice(index, close + 1));
			if (close === words.length) return index;
			index = close + 1;
			continue;
		}
		if (value === "for" || value === "select") {
			if (isArithmeticCommand(words[index + 1])) {
				evaluated.push(words[index + 1] as ShellWord);
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
			if (isArithmeticCommand(word)) evaluated.push(word);
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

/**
 * Whether `word` may reach the wrapper as more or fewer than one argv word:
 * an unquoted expansion, brace, glob or opaque part word-splits or expands to
 * several, and so does a `@` expansion in double quotes (`"$@"`,
 * `"${a[@]}"`). Bare, quoted and ANSI-C text, a tilde and any other
 * double-quoted expansion (`"$v"`, `"$*"`) stay one word.
 */
const mayNotBeOneWord = (word: ShellWord | undefined): boolean =>
	word?.parts.some((part) => {
		switch (part.kind) {
			case "bare":
			case "singleQuoted":
			case "ansiC":
			case "tilde":
				return false;
			case "doubleQuoted":
				return part.expansions.some((expansion) => expansion.kind === "variable" && expansion.expression.includes("@"));
			default:
				return true;
		}
	}) === true;

/**
 * Whether `word` is exactly `--` after quote removal: `"maybe"` when it has
 * no literal and its literal prefix could still grow into one.
 */
const endOfArgs = (word: ShellWord | undefined): "yes" | "no" | "maybe" => {
	if (word === undefined) return "no";
	if (Option.isSome(word.literal)) return word.literal.value === "--" ? "yes" : "no";
	return "--".startsWith(literalPrefix(word)) ? "maybe" : "no";
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
		// The text the wrapper is sure to see: `env B="$X" git` expands the
		// value, but `B=` is literal, so `env` still reads an assignment.
		const prefix = literalPrefix(word);
		const option = options && prefix.startsWith("-");
		const assignment =
			spec.assignments === "env" || (spec.assignments === "sudo" && prefix[0] !== "/" && prefix[0] !== "=");
		if (!option && assignment && prefix.includes("=")) {
			if (spec.assignments === "sudo") {
				// sudo's `got_end_of_args`: the argv word before this one is
				// exactly `--`, whatever role it played, an option's value
				// included. One that may expand to `--` leaves the role unknown.
				const end = endOfArgs(words[index - 1]);
				if (end === "maybe") return { kind: "unknown", index };
				if (end === "yes") return { kind: "next", index };
			}
			// `env A=$v git` splits into `A=1` and the command `c1` when `v` is `1 c1`.
			if (mayNotBeOneWord(word)) return { kind: "unknown", index };
			// `env` reads no option after its first assignment.
			if (spec.assignments === "env") options = false;
			index += 1;
			continue;
		}
		const literal = word.literal;
		// A word with no literal ends resolution at it: the caller reports no name.
		if (Option.isNone(literal)) return { kind: "next", index };
		const value = literal.value;
		if (option) {
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
				const resolved = longOption(spec, equals === -1 ? value.slice(2) : value.slice(2, equals));
				if (resolved === "stop" || resolved === "unknown") return { kind: "unknown", index };
				if (equals === -1 && resolved === "argument") {
					if (mayNotBeOneWord(words[index + 1])) return { kind: "unknown", index };
					index += 2;
				} else index += 1;
				continue;
			}
			let consumed = 1;
			for (let k = 1; k < value.length; k += 1) {
				const short = value[k] as string;
				if (spec.stopShort.includes(short)) return { kind: "unknown", index };
				if (spec.keepShort.includes(short)) return { kind: "keep" };
				if (spec.short.includes(short)) {
					if (k === value.length - 1) consumed = 2;
					break;
				}
				// An option the table does not know may take an argument.
				if (!spec.flags.includes(short)) return { kind: "unknown", index };
			}
			// The value word an option takes: `env -u $v git` runs `c1` when `v`
			// is `X c1`, so a value that may split leaves the command unknown.
			if (consumed === 2 && mayNotBeOneWord(words[index + 1])) return { kind: "unknown", index };
			index += consumed;
			continue;
		}
		// `env - -i git`: a lone `-` after the options is `-i` too.
		if (value === "-" && spec.dashAlone) {
			index += 1;
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
 * A segment whose only command is a `[[ … ]]` or an arithmetic command
 * `((…))` resolves to the name `[[` or `((`, with the words after it as
 * `args`: bash evaluates it, and evaluation can run a command that no
 * substitution shows (`[[ 'a[$(cmd)]' -eq 0 ]]` runs `cmd`), so a guard
 * needs a name to refuse. Run straight into `then` or `do` in the same
 * segment (`if [[ x ]] then git commit; fi`) it is skipped, and the command
 * after it is the name.
 *
 * `evaluated` lists the words of every `[[ … ]]` and arithmetic command
 * `((…))` the segment evaluates, in source order, whether skipped on the way
 * to the name or the name itself: each `[[ … ]]` from `[[` to its `]]` (to
 * the segment's end when it has none), each `((…))` as its one word,
 * `for ((…))` included. So `if [[ x -eq 0 ]] then git commit; fi` names
 * `git`, with the `[[`, `x`, `-eq`, `0` and `]]` words in `evaluated`, and a
 * guard refuses arithmetic tests by reading it rather than the segment's
 * words. The segmenter splits a `[[ … ]]` on `&&`, `||` and `(`, so its
 * later operands sit in later segments, outside this list: follow an
 * unclosed one into them.
 *
 * Two shapes resolve to `None`, and a guard must tell them apart by `args`:
 *
 * - **No command at all**, with no args: a segment with no words, or only
 *   words that run nothing, such as `fi`, `}`, `done` or the assignments of
 *   `FOO=$(cmd)`. Any substitution inside one is still listed by
 *   `ShellScript.substitutions`.
 * - **A command the analyzer cannot name**, with `args` the words from the
 *   one resolution stopped at, inclusive: a command word with no literal
 *   (`$GIT commit` gives the args `$GIT`, `commit`), an `env -S` string, or
 *   a wrapper option its table does not know (`env --i FOO git` gives the
 *   args `--i`, `FOO`, `git`).
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
	evaluated: Schema.Array(ShellWord),
}) {
	/**
	 * The wrapper commands {@link ShellCommand.fromSegment} unwraps.
	 *
	 * @remarks
	 * `sudo` (sudo 1.9's options and `NAME=value` words), `env` (GNU
	 * coreutils 9.x, whose `-a NAME` / `--argv0` is new in 9.x, with BSD's
	 * `-P DIR` and FreeBSD's `-L` and `-U`, `-`, and `NAME=value` words),
	 * `command` (`-p`), `exec` (`-a NAME`, `-c`, `-l`), `nohup` and `time`
	 * (the reserved word's `-p`, GNU and BSD `time`'s options, and unquoted
	 * assignments, since `time` is a reserved word). Each option table is the
	 * union of those implementations, so no option one of them reads with an
	 * argument is read as a flag.
	 *
	 * Options are read as `getopt_long` reads them: a long option is its
	 * exact name or a unique prefix of one (`env --unse FOO` is `--unset`,
	 * `sudo --us root` is `--user`), clustered short options end at the
	 * first that takes an argument, and an option the table does not know,
	 * or a prefix of more than one name (`env --i`), stops resolution with no
	 * name, since it may take the word after it. `env` reads options up to
	 * `--` or its first other word, and from there every word holding an `=`
	 * is an assignment, so `env -- -x=1 git` and `env =x git` unwrap to `git`
	 * while `env A=1 -i git` runs `-i`; a lone `-` is skipped without ending
	 * the options, as BSD `env` reads it. `sudo` reads a `NAME=value` word
	 * among its options, but never one whose first character is `/` or `=`,
	 * and never one right after an argv word that is exactly `--`, an
	 * option's value included, so `sudo /opt/x=1/git`, `sudo =x` and
	 * `sudo -p -- A=1 git` run that word. A `NAME=value` word counts after
	 * quote removal for `env` and `sudo`, as they read their argv, so
	 * `env "FOO=a b" git` unwraps to `git`; a quoted option (`env "-i"`) is an
	 * option too. A word a wrapper steps over, an option's separate value or a
	 * `NAME=value` word, that may not reach it as exactly one argv word stops
	 * resolution with no name: an unquoted expansion, brace or glob
	 * (`env -u $v git`, `exec -a {x,y} git`), or a double-quoted `"$@"`, since
	 * bash splits it and the wrapper may run a word the analyzer never sees.
	 * A double-quoted `"$v"` is one word, so `env -u "$v" git` unwraps. A
	 * wrapper is recognized by its last path segment, so `/usr/bin/env`
	 * unwraps. `command -v` and `command -V` only look a name up, so they do
	 * not unwrap: the command is `command`. `env -S` splits a string into a command line, which is not
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
	 * The command as an assignment builtin, `declare`, `typeset`, `local`,
	 * `export` or `readonly`: its `args` split into options and operands as
	 * bash reads them, and where its array values' keys become strings.
	 *
	 * @remarks
	 * `Some` when `name` is exactly one of the five, wrapped or not (a path
	 * such as `/bin/export` names no builtin), and `None` otherwise. Read the
	 * options from it rather than from `args`: `declare y=1 -i` has no `-i`
	 * option, and a word that may expand to one leaves `resolved` `false`.
	 * Read the keys from `associativeFrom`, never from the options: bash
	 * marks them from the words as written, so `declare -- -A x=([k]=1)`
	 * keeps `k` a string while `declare "-A" x=([k]=1)` evaluates it as
	 * arithmetic. See {@link ShellAssignmentBuiltin}.
	 *
	 * @example
	 * ```ts
	 * import { ShellCommand, ShellSyntax } from "@effected/shell";
	 * import { Option } from "effect";
	 *
	 * const [segment] = ShellSyntax.parse("declare -ix -- -A y=1").segments;
	 * const view = Option.getOrThrow(ShellCommand.fromSegment(segment!).assignmentBuiltin);
	 * console.log(view.options.map((w) => w.raw), view.operands.map((w) => w.raw), view.associativeFrom);
	 * // => [ '-ix' ] [ '-A', 'y=1' ] { _id: 'Option', _tag: 'Some', value: 1 }
	 * ```
	 */
	get assignmentBuiltin(): Option.Option<ShellAssignmentBuiltin> {
		if (Option.isNone(this.name)) return Option.none();
		const words = this.segment.words;
		const word = words[words.length - this.args.length - 1];
		return readAssignmentBuiltin(this.name.value, word, this.args, this.wrappers.length > 0);
	}

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
		const evaluated: Array<ShellWord> = [];
		const resolved = (name: Option.Option<string>, args: ReadonlyArray<ShellWord>): ShellCommand =>
			ShellCommand.make({ segment, name, args, wrappers, evaluated });
		let from = 0;
		let index = skipPrefix(words, from, evaluated);
		for (;;) {
			const word = words[index];
			if (word === undefined) {
				// Nothing named a command: a `[[ … ]]` or `((…))` skipped on the
				// way is the command, since bash evaluates it.
				for (let k = from; k < words.length; k += 1) {
					const test = conditionalName(words[k]);
					if (test !== undefined) return resolved(Option.some(test), words.slice(k + 1));
				}
				return resolved(Option.none(), []);
			}
			const literal = word.literal;
			if (Option.isNone(literal)) return resolved(Option.none(), words.slice(index));
			const spec = WRAPPERS.get(basename(literal.value));
			if (spec === undefined) return resolved(literal, words.slice(index + 1));
			const step = skipOptions(words, index + 1, spec);
			if (step.kind === "keep") return resolved(literal, words.slice(index + 1));
			wrappers.push(literal.value);
			if (step.kind === "unknown") return resolved(Option.none(), words.slice(step.index));
			// `time` is a reserved word timing a whole pipeline: `time { git commit; }`.
			from = step.index;
			index = basename(literal.value) === "time" ? skipPrefix(words, step.index, evaluated) : step.index;
		}
	}
}
