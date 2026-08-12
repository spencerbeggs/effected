// The lint engine (#129): the rule-aware config schema and the `YamlLint`
// facade (`run`, `fix`, `builtins`). The rule model (`LintContext`,
// `YamlRule`, `YamlLintDiagnostic`) lives in `YamlLintRule.ts` — see the
// cycle-firewall note there.
//
// The governing constraint: v1 is the pure half only. No file discovery, no
// config-file loading, no IO, no CLI — strings in, diagnostics or a fixed
// string out. The runner is someone else's tier.

import { Result, Schema } from "effect";
import { composeFirstDocument } from "./internal/composer/document.js";
import { isFatalCode } from "./internal/diagnostics.js";
import { builtinOptionsSchemas, builtinRules } from "./internal/rules/catalog.js";
import { YamlParseError } from "./Yaml.js";
import { YamlDiagnostic } from "./YamlDiagnostic.js";
import { documentFromRaw } from "./YamlDocument.js";
import { YamlEdit } from "./YamlEdit.js";
import type { LintContext, LintLine, YamlLintSeverity, YamlRule } from "./YamlLintRule.js";
import { YamlLintDiagnostic } from "./YamlLintRule.js";
import { YamlTokens } from "./YamlToken.js";

// ── Config ──────────────────────────────────────────────────────────────────

/**
 * One entry of the config `rules` map: a bare severity literal (the common
 * case), `"off"` to disable, or a typed per-rule options object (the tuning
 * case; may carry its own `severity`).
 *
 * @public
 */
export const YamlLintRuleSetting = Schema.Union([
	Schema.Literals(["error", "warning", "off"]),
	Schema.Record(Schema.String, Schema.Unknown),
]);

/**
 * The union type of one `rules`-map entry.
 *
 * @public
 */
export type YamlLintRuleSetting = typeof YamlLintRuleSetting.Type;

/** Rule-aware validation of the config `rules` map (undefined = valid). */
const validateRulesMap = (rules: { readonly [id: string]: YamlLintRuleSetting }): string | undefined => {
	for (const [id, entry] of Object.entries(rules)) {
		if (id === "parse-validity") {
			// Always-on rule #1: it cannot be demoted, disabled or configured.
			// Failing loud beats silently ignoring an entry that looks like it
			// does something.
			if (entry === "off" || entry === "warning") {
				return `Rule "parse-validity" is always-on and cannot be set to "${entry}"`;
			}
			if (typeof entry === "object") {
				return `Rule "parse-validity" accepts no options`;
			}
			continue;
		}
		if (typeof entry === "object") {
			const optionsSchema = builtinOptionsSchemas.get(id);
			// Custom rule ids carry opaque options the custom rule validates
			// itself; built-in options are validated against the rule's own
			// exported schema so a typo'd option fails here, typed, instead of
			// travelling as `unknown` into the rule.
			if (optionsSchema !== undefined) {
				// onExcessProperty: "error" — a typo'd option KEY fails loudly with
				// an UnexpectedKey issue naming the key, instead of decoding to {}
				// (v4 Structs strip unknown keys by default).
				const decoded = Schema.decodeUnknownResult(optionsSchema as Schema.Codec<unknown, unknown>, {
					onExcessProperty: "error",
				})(entry);
				if (Result.isFailure(decoded)) {
					return `Invalid options for rule "${id}": ${String(decoded.failure)}`;
				}
			}
		}
	}
	return undefined;
};

/**
 * The lint configuration: a `rules` map keying rule ids (built-in or custom)
 * to a severity literal or a typed per-rule options object.
 *
 * Validation is rule-aware for the built-in catalog — a mistyped option on a
 * built-in rule fails schema validation with a typed error naming the rule,
 * and any attempt to demote or disable the always-on `parse-validity` rule
 * is rejected. Custom rule ids are accepted with a bare severity or an
 * opaque options object the custom rule validates itself.
 *
 * Presets ship as the statics {@link YamlLintConfig.default} and
 * {@link YamlLintConfig.relaxed} — composing one is object spread over a
 * static, not an `extends` string resolution step (this package owns no
 * config-file loader).
 *
 * @public
 */
export class YamlLintConfig extends Schema.Class<YamlLintConfig>("YamlLintConfig")({
	rules: Schema.Record(Schema.String, YamlLintRuleSetting).pipe(Schema.check(Schema.makeFilter(validateRulesMap))),
}) {
	/**
	 * The default preset. Rule entries accrete as built-ins land; the
	 * `quoted-strings` rule defaults to DOUBLE quotes here (the one taste
	 * call the design pins).
	 */
	static readonly default: YamlLintConfig = YamlLintConfig.make({
		rules: {
			"line-length": "error",
			"trailing-spaces": "error",
			"empty-lines": "error",
			"eof-newline": "error",
			"key-duplicates": "error",
			"quoted-strings": { quoteType: "double" },
			truthy: "error",
			"comments-spacing": "error",
			"colon-spacing": "error",
			"hyphen-spacing": "error",
			indentation: "error",
		},
	});

	/** The relaxed preset: style rules demoted to warnings. */
	static readonly relaxed: YamlLintConfig = YamlLintConfig.make({
		rules: {
			"line-length": "warning",
			"trailing-spaces": "warning",
			"empty-lines": "warning",
			"eof-newline": "warning",
			"key-duplicates": "error",
			"quoted-strings": { quoteType: "double", severity: "warning" },
			truthy: "warning",
			"comments-spacing": "warning",
			"colon-spacing": "warning",
			"hyphen-spacing": "warning",
			indentation: "warning",
		},
	});
}

// ── Context construction ────────────────────────────────────────────────────

/** Split `text` into positioned lines (line text excludes the terminator). */
const buildLines = (text: string): ReadonlyArray<LintLine> => {
	const lines: Array<LintLine> = [];
	let offset = 0;
	let number = 0;
	while (offset <= text.length) {
		const nl = text.indexOf("\n", offset);
		const end = nl === -1 ? text.length : nl;
		// The final empty segment after a trailing newline is not a line.
		if (offset === text.length && number > 0) break;
		lines.push({ text: text.slice(offset, end), offset, number });
		if (nl === -1) break;
		offset = nl + 1;
		number++;
	}
	return lines;
};

/**
 * Build the eager lint context: tokenize once, compose once (through the
 * RECOVERED path, so the context exists for malformed input too — the
 * `parse-validity` rule reports what went wrong).
 */
const buildContext = (text: string): LintContext => {
	const tokens = Result.match(YamlTokens.tokenize(text), {
		onSuccess: (value) => value,
		onFailure: (error) => {
			// The tokenize failure channel is reserved and never fires today.
			throw error;
		},
	});
	return {
		text,
		lines: buildLines(text),
		tokens,
		// uniqueKeys: false — duplicate-key POLICY belongs to the configurable
		// `key-duplicates` rule, so the engine's own duplicate warnings are
		// switched off here and `parse-validity` never double-reports them.
		document: documentFromRaw(composeFirstDocument(text, { uniqueKeys: false }), text),
	};
};

// ── Facade ──────────────────────────────────────────────────────────────────

/** Resolve the effective severity of a configured entry. */
const resolveSeverity = (entry: YamlLintRuleSetting): YamlLintSeverity => {
	if (entry === "error" || entry === "warning") return entry;
	if (typeof entry === "object" && (entry.severity === "error" || entry.severity === "warning")) {
		return entry.severity;
	}
	return "error";
};

const byPosition = (a: YamlLintDiagnostic, b: YamlLintDiagnostic): number =>
	a.offset - b.offset || a.length - b.length || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0);

/**
 * Linting statics. Not instantiable.
 *
 * @remarks
 * Pure and synchronous throughout — the lint engine is the pure half only:
 * strings in, diagnostics or a fixed string out. File discovery, config-file
 * loading and autofix-to-disk belong to a consumer's tier, not here.
 *
 * @public
 */
export class YamlLint {
	private constructor() {}

	/**
	 * The built-in rule catalog. Custom usage is array concatenation:
	 * `YamlLint.run(text, [...YamlLint.builtins, myRule], config)`.
	 */
	static readonly builtins: ReadonlyArray<YamlRule> = builtinRules;

	/**
	 * Run `rules` over `text` under `config`, returning every finding sorted
	 * by position.
	 *
	 * A rule runs when its config entry is a severity or an options object;
	 * `"off"` and absent entries skip it — except `parse-validity`, which is
	 * always-on. The resolved severity (explicit-in-options, else the bare
	 * literal, else `"error"`) overrides what the rule emitted, again except
	 * for `parse-validity`, whose bridged engine diagnostics keep the
	 * engine's own grading.
	 */
	static run(text: string, rules: ReadonlyArray<YamlRule>, config: YamlLintConfig): ReadonlyArray<YamlLintDiagnostic> {
		const ctx = buildContext(text);
		const out: Array<YamlLintDiagnostic> = [];
		for (const rule of rules) {
			const alwaysOn = rule.id === "parse-validity";
			const entry = alwaysOn ? "error" : config.rules[rule.id];
			if (entry === undefined || entry === "off") continue;
			const severity = resolveSeverity(entry);
			const options = typeof entry === "object" ? entry : undefined;
			for (const diagnostic of rule.check(ctx, options)) {
				out.push(
					alwaysOn || diagnostic.severity === severity
						? diagnostic
						: new YamlLintDiagnostic({ ...diagnostic, severity }),
				);
			}
		}
		return out.sort(byPosition);
	}

	/**
	 * Run `rules` and apply every non-overlapping surgical fix, returning the
	 * fixed text. Fails with {@link YamlParseError} when the input has a
	 * fatal parse error — a document the engine cannot compose is not safely
	 * fixable. Fixes route exclusively through `YamlEdit.applyAll` (never a
	 * reformat), so applying them is comment-safe by construction; when two
	 * fixes overlap — or start at the same offset — the earlier one in
	 * {@link YamlLint.run} order (position, then rule id) wins and the later
	 * is dropped (its diagnostic remains reported by {@link YamlLint.run}).
	 */
	static fix(
		text: string,
		rules: ReadonlyArray<YamlRule>,
		config: YamlLintConfig,
	): Result.Result<string, YamlParseError> {
		const raw = composeFirstDocument(text, {});
		const fatal = raw.errors.filter((e) => isFatalCode(e.code));
		if (fatal.length > 0) {
			return Result.fail(
				new YamlParseError({ diagnostics: fatal.map((e) => YamlDiagnostic.fromRaw(e, text)), input: text }),
			);
		}
		const fixes: Array<YamlEdit> = [];
		let lastEnd = -1;
		let lastOffset = -1;
		for (const diagnostic of YamlLint.run(text, rules, config)) {
			const fix = diagnostic.fix;
			if (fix === undefined) continue;
			// Overlapping — and same-offset (two zero-length insertions at one
			// position would apply in arbitrary order) — earlier fix wins.
			if (fix.offset < lastEnd || fix.offset === lastOffset) continue;
			fixes.push(fix);
			lastEnd = fix.offset + fix.length;
			lastOffset = fix.offset;
		}
		return Result.succeed(YamlEdit.applyAll(text, fixes));
	}
}
