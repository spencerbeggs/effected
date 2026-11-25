// The tokenizer the root structural tests share: they hold rules about what test files may contain, and a rule
// read from tokens is not fooled by a comment or a string that merely mentions what it forbids.

import { LanguageVariant, SyntaxKind, createScanner } from "typescript/ast";

/** Tokens that end an operand: a `/` after one is division, anywhere else it opens a regex. */
const REGEX_CANNOT_FOLLOW: ReadonlySet<SyntaxKind> = new Set([
	SyntaxKind.Identifier,
	SyntaxKind.PrivateIdentifier,
	SyntaxKind.NumericLiteral,
	SyntaxKind.BigIntLiteral,
	SyntaxKind.StringLiteral,
	SyntaxKind.RegularExpressionLiteral,
	SyntaxKind.NoSubstitutionTemplateLiteral,
	SyntaxKind.TemplateTail,
	SyntaxKind.CloseParenToken,
	SyntaxKind.CloseBracketToken,
	SyntaxKind.CloseBraceToken,
	SyntaxKind.PlusPlusToken,
	SyntaxKind.MinusMinusToken,
	SyntaxKind.ThisKeyword,
	SyntaxKind.SuperKeyword,
	SyntaxKind.TrueKeyword,
	SyntaxKind.FalseKeyword,
	SyntaxKind.NullKeyword,
]);

/** One code token: its kind, its text (an identifier's name, a string literal's unquoted value), and its offset. */
export interface Token {
	readonly kind: SyntaxKind;
	readonly value: string;
	readonly start: number;
}

/**
 * The code tokens of `text`, trivia skipped, with template substitutions
 * scanned as code and template text as template spans — the same steering
 * `packages/github-actions/__test__/ambientReads.test.ts` documents.
 */
export const tokenize = (text: string): ReadonlyArray<Token> => {
	const tokens: Array<Token> = [];
	const scanner = createScanner(true, LanguageVariant.Standard, text);
	const templateDepths: Array<number> = [];
	let depth = 0;
	let token = scanner.scan();
	let lastStart = -1;
	while (token !== SyntaxKind.EndOfFile) {
		// The scanner has no parser context: a `/` where an operand is expected starts a regex
		// literal, and is rescanned as one so its body (`#`, quotes, `${`) is not read as code.
		if (
			(token === SyntaxKind.SlashToken || token === SyntaxKind.SlashEqualsToken) &&
			!REGEX_CANNOT_FOLLOW.has(tokens[tokens.length - 1]?.kind ?? SyntaxKind.Unknown)
		) {
			token = scanner.reScanSlashToken();
		}
		// A token the scanner cannot advance past (a stray `#`) is stepped over, never looped on.
		if (scanner.getTokenStart() <= lastStart) {
			scanner.resetTokenState(lastStart + 1);
			token = scanner.scan();
			continue;
		}
		lastStart = scanner.getTokenStart();
		if (token === SyntaxKind.TemplateHead || token === SyntaxKind.TemplateMiddle) {
			templateDepths.push(depth);
		} else if (token === SyntaxKind.OpenBraceToken) {
			depth += 1;
		} else if (token === SyntaxKind.CloseBraceToken) {
			if (templateDepths[templateDepths.length - 1] === depth) {
				templateDepths.pop();
				token = scanner.reScanTemplateToken(false);
				if (token === SyntaxKind.TemplateMiddle) {
					templateDepths.push(depth);
				}
				tokens.push({ kind: token, value: "", start: scanner.getTokenStart() });
				token = scanner.scan();
				continue;
			}
			depth -= 1;
		}
		tokens.push({
			kind: token,
			// An identifier's name and a string literal's unquoted value; raw text for everything else.
			value:
				token === SyntaxKind.Identifier ||
				token === SyntaxKind.StringLiteral ||
				token === SyntaxKind.NoSubstitutionTemplateLiteral
					? scanner.getTokenValue()
					: scanner.getTokenText(),
			start: scanner.getTokenStart(),
		});
		token = scanner.scan();
	}
	return tokens;
};
