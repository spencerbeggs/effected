// The ajv setup both shipped engines share: one strict-mode instance
// construction, one format-vocabulary registration, one declared-keyword
// walk. AjvValidator (documents) and AjvInstanceValidator (payloads) must
// not drift apart — a document the gate admits has to compile in the
// instance engine too, or `schemastore validate` would refuse a document
// `schemastore check` just passed.

import { KeywordFamilies } from "@effected/schemastore";
import type { Ajv as AjvType } from "ajv";
import { Ajv } from "ajv";
import ajvFormats from "ajv-formats";

// `ajv-formats` does `module.exports = exports = formatsPlugin` but declares
// `export default` in its `.d.ts`, so TypeScript models the default import as
// the module namespace and calling it directly is a TS2349. Its `.default`
// points back at the plugin itself, which is the callable under BOTH Node's
// ESM interop (where the binding is `module.exports`) and an
// `__esModule`-honouring bundler (where it is `exports.default`) — so this one
// hop lands on the plugin in either world, with its real types and no cast.
const addFormats = ajvFormats.default;

// Mirrors the library's `MAX_NESTING_DEPTH` (`internal/limits.ts`, not on
// its public surface — that file cross-references this one). The two must
// move together: a document the library admits at depth N whose declared
// keywords this walk stopped collecting before N would fail strict mode as
// unknown keywords, a false gate failure.
const MAX_KEYWORD_WALK_DEPTH = 256;

// ajv strict mode rejects any keyword it does not know, which would fail
// every document carrying a declared language-server family — exactly the
// keywords `DocumentLint` deliberately allows. Registering them keeps the
// engine's verdict consistent with the owned lint's, through the same
// `KeywordFamilies` predicate, so the two cannot drift.
const collectDeclaredKeywords = (node: unknown, into: Set<string>, depth: number): void => {
	if (depth >= MAX_KEYWORD_WALK_DEPTH || typeof node !== "object" || node === null) {
		return;
	}
	if (Array.isArray(node)) {
		for (const element of node) {
			collectDeclaredKeywords(element, into, depth + 1);
		}
		return;
	}
	for (const [key, value] of Object.entries(node)) {
		if (KeywordFamilies.isDeclared(key)) {
			// The payload is opaque advice the library copied verbatim, and ajv
			// never strict-checks inside a registered keyword's value — so a
			// prefix-matching key INSIDE it (`x-ai-model.name`) is data, not a
			// keyword. Registering it would make ajv's name grammar reject a
			// document the library accepted. Stop at the declared key.
			into.add(key);
			continue;
		}
		collectDeclaredKeywords(value, into, depth + 1);
	}
};

/**
 * Build the shared strict-mode ajv instance over a document: the standard
 * `ajv-formats` vocabulary registered (`keywords: false` is load-bearing —
 * the plugin's default ALSO registers `formatMaximum` / `formatMinimum` and
 * their exclusive variants, which `DocumentLint` answers as unknown
 * keywords, and registering them would drift the two verdicts apart), plus
 * every declared `KeywordFamilies` keyword the document carries.
 *
 * THROWS when ajv itself refuses the setup — most often a declared keyword
 * whose NAME ajv's own grammar (`/^[a-z_$][a-z0-9_$:-]*$/i`) rejects, such
 * as an `x-ai-*` key carrying a dot or a space. Each caller decides what
 * that throw means for its subject: a finding for `AjvValidator` (the
 * document IS the subject there), an engine failure for
 * `AjvInstanceValidator` (there the subject is the instance, and a document
 * that will not compile yields no verdict about it).
 */
export const makeAjv = (document: unknown, strict: boolean): AjvType => {
	const ajv = new Ajv({ strict, allErrors: true });
	// Without the standard format vocabulary, strict mode rejects every
	// document using `format` as an unknown format, so a consumer cannot say
	// "this string is an ISO-8601 instant" — only a `pattern` fallback. An
	// unknown format string still fails strict mode.
	addFormats(ajv, { keywords: false });
	const declared = new Set<string>();
	collectDeclaredKeywords(document, declared, 0);
	// `addKeyword` sits here rather than at the call sites on purpose: ajv
	// holds a keyword NAME to `/^[a-z_$][a-z0-9_$:-]*$/i`, so a declared key
	// carrying a dot, a space or an `@` makes it throw. Each caller catches
	// and re-marks that throw for its own subject.
	for (const keyword of declared) {
		ajv.addKeyword({ keyword });
	}
	return ajv;
};
