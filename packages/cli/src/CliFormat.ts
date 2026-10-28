import type { Audience, TerminalEnv } from "@effected/env";
import { Console, Effect, Option } from "effect";
import type { Param } from "effect/cli";
import { CliError, Flag } from "effect/cli";
import type { CliLinks } from "./CliLinks.js";
import type { CliTheme } from "./CliTheme.js";
import type { Document } from "./Doc.js";
import { Doc } from "./Doc.js";
import { underGithubActions } from "./internal/autoFormat.js";
import { neutralizeJson } from "./internal/logSafety.js";

/**
 * An output format a `--format` flag can offer: `auto` (the renderer the audience gets, as `Doc.print` picks it),
 * one of the `Doc` renderers by name, or `json`, the command's data rather than its document.
 *
 * @public
 */
export type CliFormatName = "auto" | "plain" | "ansi" | "markdown" | "githubLog" | "json";

/**
 * The retired boolean flag {@link CliFormatFlagOptions.legacyJson} accepts, spelled as an object.
 *
 * @public
 */
export interface CliFormatLegacyJson {
	/** The retired flag's name; `json` by default. */
	readonly name?: string | undefined;
	/** Whether giving it writes the one-line deprecation notice to stderr; `true` by default. */
	readonly notice?: boolean | undefined;
}

/**
 * Options for {@link CliFormat.flag}.
 *
 * @typeParam F - the built-in formats offered under their own names
 * @typeParam A - the caller's alias names, each standing for a built-in format
 * @typeParam C - the caller's own formats, which the caller renders itself
 *
 * @public
 */
export interface CliFormatFlagOptions<
	F extends CliFormatName,
	A extends Readonly<Record<string, CliFormatName>> = Record<never, CliFormatName>,
	C extends string = never,
> {
	/**
	 * The format when the flag is not given, spelled as on the command line (an alias by its own name): `auto` when it
	 * is offered, otherwise the first one.
	 */
	readonly default?: F | Extract<keyof A, string> | C | undefined;
	/** The flag's name; `format` by default. */
	readonly name?: string | undefined;
	/** The flag's description in help; one naming the offered formats by default. */
	readonly description?: string | undefined;
	/**
	 * Names of the caller's own that stand for a built-in format: `{ human: "auto" }` offers `--format human`, whose
	 * value is `auto`. The target need not be offered under its own name, so `["json"]` with `{ human: "auto" }` offers
	 * exactly `json` and `human`. An alias may not reuse a built-in format's name or any other offered name.
	 */
	readonly aliases?: A | undefined;
	/**
	 * Formats the caller renders itself, such as `mermaid` or `dot`: offered under their own names and yielded as
	 * themselves. {@link CliFormat.print} takes none of them; branch on a custom value before printing. A custom name
	 * may not reuse a built-in format's name or any other offered name.
	 */
	readonly custom?: ReadonlyArray<C> | undefined;
	/**
	 * Accept a retired boolean `--json` as `--format json`, for a CLI moving onto this flag from a flag of its own.
	 * `true` accepts `--json`; a {@link CliFormatLegacyJson} names the flag or silences the notice.
	 *
	 * @remarks
	 * The retired flag is hidden from help and has no `--no-json` form. Given, it writes one line to stderr through
	 * `Console.error`, never stdout where the JSON goes, saying to use `--format json`, unless `notice` is `false`.
	 * Given together with the format flag it is a usage error, whatever the format, rather than one silently winning.
	 * The flag must be able to yield `json` (offered, or an alias for it): asking for this otherwise is a programming
	 * mistake and throws.
	 */
	readonly legacyJson?: boolean | CliFormatLegacyJson | undefined;
}

/**
 * What {@link CliFormat.print} prints: the command's document and, for `json`, its data.
 *
 * @public
 */
export interface CliFormatOutput {
	/** The document, built only when a document format is chosen. */
	readonly doc: () => Document;
	/** The data `json` prints, built only when `json` is chosen. A `json` format with no `json` here is a defect. */
	readonly json?: (() => unknown) | undefined;
}

/**
 * Options for {@link CliFormat.print}.
 *
 * @public
 */
export interface CliFormatPrintOptions {
	/** The stream to write to; stdout by default. */
	readonly stream?: "stdout" | "stderr" | undefined;
	/** The JSON indent, in spaces; `2` by default, `0` for one line. */
	readonly indent?: number | undefined;
}

const BUILT_IN: ReadonlySet<string> = new Set<CliFormatName>([
	"auto",
	"plain",
	"ansi",
	"markdown",
	"githubLog",
	"json",
]);

/**
 * The format flag, made optional, joined with a hidden optional boolean for the retired spelling: both are parsed, so
 * giving both is refused rather than one winning.
 *
 * Core has no combinator that parses two flags into one value (`Flag.orElse` runs its alternative only when the first
 * fails), so this builds core's own `Param.Transform` node: `Flag.orElse` supplies one that carries both flags, which
 * keeps the parser and help aware of the retired flag, and its `f` is replaced by one that runs both parses. A
 * combinator applied to the result later (`Flag.withDescription`, say) rebuilds the node through `f`, so the join
 * survives it.
 */
const withLegacyJson = <V>(
	format: Flag.Flag<V>,
	options: {
		readonly name: string;
		readonly legacyName: string;
		readonly json: V;
		readonly fallback: V;
		readonly notice: boolean;
	},
): Flag.Flag<V> => {
	const retired = Flag.Boolean(options.legacyName).pipe(Flag.withoutNegation, Flag.withHidden, Flag.optional);
	const base = Flag.orElse(Flag.optional(format), () => retired) as unknown as Param.Transform<
		"flag",
		Option.Option<V>,
		unknown
	>;
	const f: Param.Transform<"flag", Option.Option<V>, V>["f"] = (parseFormat, alternatives) => (args) =>
		Effect.gen(function* () {
			const parseRetired = alternatives[0];
			if (parseRetired === undefined) {
				return yield* Effect.die(new Error("CliFormat.flag: the retired flag is missing"));
			}
			const [leftover, chosen] = yield* parseFormat(args);
			const [rest, given] = (yield* parseRetired()({ ...args, arguments: leftover })) as readonly [
				ReadonlyArray<string>,
				Option.Option<boolean>,
			];
			if (!Option.getOrElse(given, () => false)) {
				return [rest, Option.getOrElse(chosen, () => options.fallback)] as const;
			}
			if (Option.isSome(chosen)) {
				return yield* new CliError.ValidationError({
					message: `--${options.legacyName} means --${options.name} json: give one of them, not both`,
				});
			}
			if (options.notice) {
				yield* Console.error(`warning: --${options.legacyName} is deprecated; use --${options.name} json`);
			}
			return [rest, options.json] as const;
		});
	const alternatives = base.alternatives.map((alternative) => () => alternative().parse);
	return Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
		f,
		parse: f(base.param.parse, alternatives),
	}) as Flag.Flag<V>;
};

/**
 * A `--format` flag and the one print that honours it, so a command builds its report once as a `Doc` and its data
 * once as a value, and never writes per-format output by hand.
 *
 * @remarks
 * The flag is core's `Flag.ChoiceWithValue` with the kit's names, default and description; the print hands every
 * document format to `Doc.print` and writes `json` itself.
 *
 * ```ts
 * const format = CliFormat.flag(["auto", "markdown", "json"])
 * const doctor = Command.make("doctor", { format }, ({ format }) =>
 *   CliFormat.print(format, { doc: () => report(results), json: () => results }),
 * )
 * ```
 *
 * @public
 */
export class CliFormat {
	private constructor() {}

	/**
	 * A `--format` flag offering `formats`, and the caller's own `aliases` and `custom` formats.
	 *
	 * @remarks
	 * Its default is `options.default`, else `auto` when it is offered, else the first format. Any other value is a
	 * usage error from core's parser, naming the accepted ones. The value is the built-in format a name stands for
	 * (`human` under `{ human: "auto" }` is `auto`), or a custom name as itself, so the value of a flag with no custom
	 * formats goes straight to {@link CliFormat.print}.
	 *
	 * Two offered names that clash (an alias or custom name reusing a built-in name, or any name offered twice), a
	 * default that is not offered, and `legacyJson` on a flag that cannot yield `json` or that shares the flag's name
	 * are programming mistakes: the call throws.
	 *
	 * ```ts
	 * // okfit's contract: --format human|json, and a graph command that also draws mermaid and dot
	 * const format = CliFormat.flag(["json"], { aliases: { human: "auto" }, default: "human" })
	 * const graph = CliFormat.flag(["json"], { custom: ["mermaid", "dot"], default: "mermaid" })
	 * // a CLI that used to take --json, still accepting it
	 * const upgrade = CliFormat.flag(["auto", "json"], { legacyJson: true })
	 * ```
	 *
	 * @param formats - the built-in formats the command offers under their own names, at least one
	 * @param options - the default, the flag's name and description, aliases, custom formats and a retired `--json`
	 */
	static readonly flag = <
		const F extends CliFormatName,
		const A extends Readonly<Record<string, CliFormatName>> = Record<never, CliFormatName>,
		const C extends string = never,
	>(
		formats: readonly [F, ...ReadonlyArray<F>],
		options?: CliFormatFlagOptions<F, A, C>,
	): Flag.Flag<F | A[keyof A] | C> => {
		type Value = F | A[keyof A] | C;
		const name = options?.name ?? "format";
		const choices: ReadonlyArray<readonly [string, Value]> = [
			...formats.map((format): readonly [string, Value] => [format, format]),
			...Object.entries(options?.aliases ?? {}).map(([alias, target]): readonly [string, Value] => [
				alias,
				target as Value,
			]),
			...(options?.custom ?? []).map((custom): readonly [string, Value] => [custom, custom]),
		];
		const offered = choices.map(([spelling]) => spelling);
		for (const [index, spelling] of offered.entries()) {
			if (offered.indexOf(spelling) !== index) {
				throw new Error(`CliFormat.flag: the format name "${spelling}" is offered twice`);
			}
			if (index >= formats.length && BUILT_IN.has(spelling)) {
				throw new Error(`CliFormat.flag: "${spelling}" is a built-in format, not an alias or a custom one`);
			}
		}
		const fallback: string = options?.default ?? (offered.includes("auto") ? "auto" : formats[0]);
		const fallbackChoice = choices.find(([spelling]) => spelling === fallback);
		if (fallbackChoice === undefined) {
			throw new Error(`CliFormat.flag: the default "${fallback}" is not one of ${offered.join(", ")}`);
		}
		const flag = Flag.ChoiceWithValue(name, choices).pipe(
			Flag.withDescription(options?.description ?? `Output format: ${offered.join(", ")} (default ${fallback})`),
		) as Flag.Flag<Value>;
		const legacy = options?.legacyJson;
		if (legacy === undefined || legacy === false) return Flag.withDefault(flag, fallbackChoice[1]);
		const legacyName = (legacy === true ? undefined : legacy.name) ?? "json";
		const json = choices.find(([, value]) => value === "json");
		if (json === undefined) throw new Error("CliFormat.flag: legacyJson needs a format that yields json");
		if (legacyName === name) throw new Error(`CliFormat.flag: the retired flag cannot also be --${name}`);
		return withLegacyJson(flag, {
			name,
			legacyName,
			json: json[1],
			fallback: fallbackChoice[1],
			notice: legacy === true || legacy.notice !== false,
		});
	};

	/**
	 * Print a command's output in `format`.
	 *
	 * @remarks
	 * `json` writes `output.json()` exactly as {@link CliFormat.printJson} writes a value, which it delegates to. Every
	 * other format prints `output.doc()` with `Doc.print`, which renders it as `auto` or the named renderer would.
	 *
	 * @param format - the chosen format, usually the value of {@link CliFormat.flag}
	 * @param output - the document and the data
	 * @param options - the stream and the JSON indent
	 */
	static readonly print = (
		format: CliFormatName,
		output: CliFormatOutput,
		options?: CliFormatPrintOptions,
	): Effect.Effect<void, never, CliTheme | TerminalEnv | Audience | CliLinks> =>
		Effect.gen(function* () {
			const stream = options?.stream ?? "stdout";
			if (format !== "json") return yield* Doc.print(output.doc(), { stream, format });
			const data = output.json;
			if (data === undefined) {
				return yield* Effect.die(new Error("CliFormat.print: format json needs output.json"));
			}
			return yield* CliFormat.printJson(data(), options);
		});

	/**
	 * Print `value` as JSON, the way {@link CliFormat.print} prints the `json` format, for a CLI that keeps a JSON flag
	 * of its own.
	 *
	 * @remarks
	 * One `Console.log` (or `Console.error` for stderr), indented by `indent`: one document, never one line per item.
	 * Under GitHub Actions a `##[` inside it is written as the JSON escape `#\u0023[`, which decodes to the same
	 * text, so the runner cannot read it as a command. A value JSON cannot hold (a cycle, a bigint, `undefined`) is a
	 * defect. It needs no theme, terminal or audience: whether this is GitHub Actions is read from `CurrentRuntimeEnv`
	 * when the environment has it, and is "no" otherwise.
	 *
	 * ```ts
	 * const status = Command.make("status", { json: Flag.Boolean("json").pipe(Flag.withDefault(false)) }, ({ json }) =>
	 *   json ? CliFormat.printJson(results) : Doc.print(report(results)),
	 * )
	 * ```
	 *
	 * @param value - the data to print
	 * @param options - the stream and the JSON indent
	 */
	static readonly printJson = (value: unknown, options?: CliFormatPrintOptions): Effect.Effect<void> =>
		Effect.gen(function* () {
			const text = yield* Effect.sync(() => JSON.stringify(value, null, options?.indent ?? 2));
			if (text === undefined) return yield* Effect.die(new Error("CliFormat.printJson: the value is not JSON"));
			const safe = (yield* underGithubActions) ? neutralizeJson(text) : text;
			yield* (options?.stream ?? "stdout") === "stdout" ? Console.log(safe) : Console.error(safe);
		});
}
