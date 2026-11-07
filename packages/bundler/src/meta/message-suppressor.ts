import type { WarningSuppressionRule } from "./config.js";

interface CompiledRule {
	readonly messageId: string | undefined;
	readonly regex: RegExp | undefined;
	readonly substring: string | undefined;
}

function compileRule(rule: WarningSuppressionRule): CompiledRule {
	if (rule.pattern === undefined) {
		return { messageId: rule.messageId, regex: undefined, substring: undefined };
	}
	try {
		return { messageId: rule.messageId, regex: new RegExp(rule.pattern), substring: undefined };
	} catch {
		// Not a valid regex: treat as a literal substring.
		return { messageId: rule.messageId, regex: undefined, substring: rule.pattern };
	}
}

export interface MessageSuppressor {
	matches(messageId: string, text: string): boolean;
}

/**
 * Build a suppressor that matches a message when its id matches exactly AND (if a pattern is set) the text matches the
 * regex/substring. The config schema allows a pattern with no id, which matches on the text across every id; a rule
 * with neither matches nothing, since it would otherwise silence every message.
 */
export function createMessageSuppressor(rules: ReadonlyArray<WarningSuppressionRule>): MessageSuppressor {
	const compiled = rules.map(compileRule);
	return {
		matches(messageId: string, text: string): boolean {
			for (const rule of compiled) {
				if (rule.messageId !== undefined && rule.messageId !== messageId) continue;
				if (rule.regex === undefined && rule.substring === undefined) {
					if (rule.messageId !== undefined) return true;
					continue;
				}
				if (rule.regex?.test(text)) return true;
				if (rule.substring !== undefined && text.includes(rule.substring)) return true;
			}
			return false;
		},
	};
}
