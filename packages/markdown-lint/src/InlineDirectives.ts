// Resolves markdownlint's inline comments (`<!-- markdownlint-disable -->`
// and friends) into a per-line enabled state. A port of markdownlint's
// `getEnabledRulesPerLineNumber`, keeping its four passes in order:
// configure-file, file-level enable/disable, capture/restore/enable/disable
// with a per-line snapshot, then disable-line and disable-next-line.

import type { EffectiveLintConfig, LintConfigRecord } from "./LintConfig.js";
import { LintConfig } from "./LintConfig.js";
import type { LintRule } from "./LintRule.js";

/**
 * The outcome of resolving inline comments over a document.
 *
 * @public
 */
export interface InlineDirectivesResult {
	/** The config after any `configure-file` comment, resolved. */
	readonly effective: EffectiveLintConfig;
	/** Index is the 1-based line number; index 0 is unused. */
	readonly enabledPerLine: ReadonlyArray<ReadonlyMap<string, boolean>>;
}

/**
 * Resolves markdownlint inline comments into per-line rule state.
 *
 * @remarks
 * Pure and synchronous; a class of static methods with no instances. Like
 * markdownlint, a `configure-file` payload is parsed as JSON only, and one
 * that fails to parse or is not an object is ignored.
 *
 * @public
 */
export class InlineDirectives {
	/**
	 * Resolve the inline comments in `lines` against `config` and `rules`.
	 */
	static resolve(
		lines: ReadonlyArray<string>,
		config: LintConfigRecord,
		rules: ReadonlyArray<LintRule>,
		options?: { readonly noInlineConfig?: boolean },
	): InlineDirectivesResult {
		const noInlineConfig = options?.noInlineConfig === true;
		// One global regex for the whole run: markdownlint's is module-level, so
		// a lastIndex left by an unclosed comment carries into the next line.
		const commentStart =
			/(<!--\s*markdownlint-(disable|enable|capture|restore|disable-file|enable-file|disable-line|disable-next-line|configure-file))(?:\s|-->)/gi;
		const aliases = new Map<string, Array<string>>();
		for (const rule of rules) {
			const ruleName = LintConfig.key(rule);
			for (const name of rule.names) {
				aliases.set(name.toUpperCase(), [ruleName]);
			}
			for (const tag of rule.tags) {
				const tagUpper = tag.toUpperCase();
				const existing = aliases.get(tagUpper);
				if (existing === undefined) {
					aliases.set(tagUpper, [ruleName]);
				} else {
					existing.push(ruleName);
				}
			}
		}

		const handleInlineConfig = (
			input: ReadonlyArray<string>,
			forEachMatch: (action: string, parameter: string, lineNumber: number) => void,
			forEachLine?: () => void,
		): void => {
			for (const [lineIndex, line] of input.entries()) {
				if (!noInlineConfig) {
					let match: RegExpExecArray | null = commentStart.exec(line);
					while (match !== null) {
						const action = (match[2] as string).toUpperCase();
						const startIndex = match.index + (match[1] as string).length;
						const endIndex = line.indexOf("-->", startIndex);
						if (endIndex === -1) {
							break;
						}
						forEachMatch(action, line.slice(startIndex, endIndex), lineIndex + 1);
						match = commentStart.exec(line);
					}
				}
				forEachLine?.();
			}
		};

		let current = config;
		handleInlineConfig([lines.join("\n")], (action, parameter) => {
			if (action === "CONFIGURE-FILE") {
				const parsed = parseJsonObject(parameter);
				if (parsed !== undefined) {
					current = { ...current, ...parsed };
				}
			}
		});
		const effective = LintConfig.effective(current, rules);
		const allRuleNames = [...effective.enabled.keys()];

		const applyEnableDisable = (
			action: string,
			parameter: string,
			state: ReadonlyMap<string, boolean> | undefined,
		): Map<string, boolean> => {
			const next = new Map(state);
			const enabled = action.startsWith("ENABLE");
			const trimmed = parameter.trim();
			const items = trimmed ? trimmed.toUpperCase().split(/\s+/) : allRuleNames;
			for (const nameUpper of items) {
				for (const ruleName of aliases.get(nameUpper) ?? []) {
					next.set(ruleName, enabled);
				}
			}
			return next;
		};

		let enabledRules: ReadonlyMap<string, boolean> = new Map(effective.enabled);
		let capturedRules = enabledRules;
		handleInlineConfig(lines, (action, parameter) => {
			if (action === "ENABLE-FILE" || action === "DISABLE-FILE") {
				enabledRules = applyEnableDisable(action, parameter, enabledRules);
			}
		});

		// Index 0 is unused; an empty map holds it so the array stays dense.
		const enabledPerLine: Array<ReadonlyMap<string, boolean>> = [new Map()];
		handleInlineConfig(
			lines,
			(action, parameter) => {
				if (action === "CAPTURE") {
					capturedRules = enabledRules;
				} else if (action === "RESTORE") {
					enabledRules = capturedRules;
				} else if (action === "ENABLE" || action === "DISABLE") {
					enabledRules = applyEnableDisable(action, parameter, enabledRules);
				}
			},
			() => {
				enabledPerLine.push(enabledRules);
			},
		);

		handleInlineConfig(lines, (action, parameter, lineNumber) => {
			const disableLine = action === "DISABLE-LINE";
			const disableNextLine = action === "DISABLE-NEXT-LINE";
			if (disableLine || disableNextLine) {
				const target = lineNumber + (disableNextLine ? 1 : 0);
				enabledPerLine[target] = applyEnableDisable(action, parameter, enabledPerLine[target]);
			}
		});

		return { effective, enabledPerLine };
	}
}

const parseJsonObject = (text: string): Record<string, unknown> | undefined => {
	try {
		const parsed: unknown = JSON.parse(text);
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
};
