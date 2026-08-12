// The lint rule model (#129): the context handed to every rule, the public
// rule interface, the severity vocabulary and the lint diagnostic.
//
// Cycle firewall: the design sketches one YamlLint.ts owning model AND
// facade, but built-in rules must construct `YamlLintDiagnostic` while the
// facade must import the built-in catalog — one module would close the cycle
// `YamlLint → rules → YamlLint` (`noImportCycles` is error-level). So the
// model lives here, `src/internal/rules/*` import it, and `YamlLint.ts`
// (config + facade) imports both. Nothing imports this module back.

import { Schema } from "effect";
import type { YamlDocument } from "./YamlDocument.js";
import { YamlEdit } from "./YamlEdit.js";
import type { YamlToken } from "./YamlToken.js";

/**
 * Lint diagnostic severities. `"off"` is a config-level disable only and
 * never reaches a diagnostic — a rule set to `"off"` is not run.
 *
 * @public
 */
export const YamlLintSeverity = Schema.Literals(["error", "warning"]);

/**
 * The union of lint severity string literals.
 *
 * @public
 */
export type YamlLintSeverity = typeof YamlLintSeverity.Type;

/**
 * A single lint finding: the reporting rule, its severity, a positioned span
 * and optionally a surgical fix.
 *
 * Deliberately separate from the engine's `YamlDiagnostic`: that type is the
 * lexer/parser/composer/stringifier error-code union and the single source
 * of truth for engine fatality — it carries no severity and no fix, and
 * lint-layer concerns must not pollute it. The `parse-validity` rule bridges
 * the two by mapping engine diagnostics into this shape.
 *
 * @public
 */
export class YamlLintDiagnostic extends Schema.Class<YamlLintDiagnostic>("YamlLintDiagnostic")({
	rule: Schema.String,
	severity: YamlLintSeverity,
	message: Schema.String,
	offset: Schema.Number,
	length: Schema.Number,
	line: Schema.Number,
	character: Schema.Number,
	fix: Schema.optionalKey(YamlEdit),
}) {}

/**
 * One source line of the linted document: its text (without the line
 * terminator — the `\n`, and for CRLF input the `\r\n` pair), the offset of
 * its first character, and its zero-based line number.
 *
 * @public
 */
export interface LintLine {
	readonly text: string;
	readonly offset: number;
	readonly number: number;
}

/**
 * The context handed to every rule. The engine tokenizes ONCE and every rule
 * shares the one materialized `tokens` array — linting is inherently
 * multi-pass and random-access (layout rules need lookahead and lookbehind),
 * so the context is eager by nature; the streaming token form exists for
 * other consumers.
 *
 * `text`, `lines` and `tokens` cover the FULL source; `document` is the
 * FIRST document of the stream (matching `Yaml.parse` — split the stream
 * `Yaml.parseAll`-style to lint every document). It is always present,
 * including for input that does not parse: it is built from the engine's
 * recovered compose, and its `errors`/`warnings` carry what went wrong (the
 * `parse-validity` rule reports them).
 *
 * @public
 */
export interface LintContext {
	readonly text: string;
	readonly lines: ReadonlyArray<LintLine>;
	readonly tokens: ReadonlyArray<YamlToken>;
	readonly document: YamlDocument;
}

/**
 * The public rule interface — built-ins and custom rules are the same
 * shape, and config references either by `id`; there is no privileged
 * built-in mechanism a custom rule cannot reach.
 *
 * `options` is the validated per-rule options object from the config entry
 * (or `undefined` when the entry was a bare severity literal); built-in
 * rules receive options already validated against their exported options
 * schema, custom rules validate their own.
 *
 * @public
 */
export interface YamlRule {
	readonly id: string;
	readonly check: (ctx: LintContext, options: unknown) => Iterable<YamlLintDiagnostic>;
}
