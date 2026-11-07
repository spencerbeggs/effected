// packages/bundler/src/passes/cjs-default-interop.ts
import type { Plugin } from "rolldown";

/**
 * The interop footer appended to a CJS ENTRY chunk that has a default export
 * alongside named exports. It reassigns `module.exports` to the default value
 * and re-attaches every named export as an own property of it.
 *
 * This is the rslib `cjsInterop: true` equivalent. rolldown's `output.exports`
 * cannot natively produce `module.exports = <default>` while ALSO keeping named
 * exports: for a default+named module both `"auto"` and `"named"` emit
 * `exports.default = <default>` (verified against rolldown 1.1.0), so an
 * ESM consumer doing `import(x).default` receives the `{ default, ...named }`
 * wrapper object rather than the default value. The footer restores the rslib
 * behavior so `import(x).default === <default>` and `require(x) === <default>`
 * (with named exports attached as properties of it).
 *
 * Why this matters concretely: markdownlint-cli2 resolves a `customRules`
 * specifier to a file path, `await import(fileURL)`, and reads `module.default`,
 * expecting it to be the rules ARRAY (it then `.flat()`s it). silk's
 * `./changesets/markdownlint` subpath default-exports the rules array plus five
 * named rule objects; without this footer `import(...).default` is the wrapper
 * object, whose `.names` is undefined, and markdownlint-cli2 aborts with
 * "Property 'names' of custom rule at index 0 is incorrect: 'undefined'".
 *
 * Limitation — PRIMITIVE defaults: promotion only happens when the default value
 * is an object or function, because named exports are re-attached to it as own
 * properties (a primitive cannot carry properties). When a cjs entry chunk has a
 * primitive default (`export default "x"` / `42` / `true`) ALONGSIDE named exports,
 * `module.exports` is left as the `{ default, ...named }` wrapper and the footer
 * emits a one-line `console.warn` so the no-op is observable rather than silent.
 * This case does not occur in the suite today (every promoted default — the
 * markdownlint rules array, the commitlint config objects — is an object), and a
 * default-ONLY primitive is unaffected: rolldown already emits `module.exports =
 * <primitive>` for it (no named exports, so this plugin never fires).
 */
const INTEROP_FOOTER = [
	"",
	"// __cjs_default_interop__ (rslib cjsInterop parity): make module.exports the",
	"// default export with named exports attached, so import(x).default is the value.",
	'if (typeof module !== "undefined" && module.exports && module.exports.default !== void 0) {',
	"\tconst __cjsDefault = module.exports.default;",
	'\tif (__cjsDefault !== null && (typeof __cjsDefault === "object" || typeof __cjsDefault === "function")) {',
	"\t\tfor (const __cjsKey of Object.keys(module.exports)) {",
	'\t\t\tif (__cjsKey === "default" || __cjsKey === "__esModule") continue;',
	"\t\t\ttry {",
	"\t\t\t\tObject.defineProperty(__cjsDefault, __cjsKey, {",
	"\t\t\t\t\tvalue: module.exports[__cjsKey],",
	"\t\t\t\t\tenumerable: true,",
	"\t\t\t\t\tconfigurable: true,",
	"\t\t\t\t\twritable: true",
	"\t\t\t\t});",
	"\t\t\t} catch {}",
	"\t\t}",
	"\t\tmodule.exports = __cjsDefault;",
	"\t} else {",
	"\t\t// Primitive default + named exports: cannot attach named props to a primitive,",
	"\t\t// so module.exports stays the wrapper. Surface the no-op instead of hiding it.",
	'\t\tif (typeof console !== "undefined")',
	'\t\t\tconsole.warn("[savvy:cjs-default-interop] primitive default export left as a {default,...named} wrapper; import().default is NOT the primitive value");',
	"\t}",
	"}",
].join("\n");

/**
 * Rolldown plugin: append the CJS default-interop footer to ENTRY chunks of the
 * `cjs` format that export a default alongside named exports.
 *
 * Gated tightly so it never touches the wrong chunk:
 *  - format must be `cjs` (ESM is untouched; `import().default` on ESM is already correct);
 *  - the chunk must be an ENTRY chunk — never a SHARED chunk. Shared chunks are required by
 *    entry chunks via their named bindings (e.g. `require_changesets.changesets_exports.X`);
 *    reassigning a shared chunk's `module.exports` to its own default would break those reads
 *    (many bundled vendor chunks carry an `exports.default`);
 *  - the chunk must export a `default` AND at least one named export. A default-only chunk
 *    already gets `module.exports = <default>` from rolldown, and a named-only chunk has no
 *    default to promote.
 *
 * The emitted footer is also self-guarded (`module.exports.default !== void 0`), so it is a
 * runtime no-op whenever the static gate is ever too generous.
 * @public
 */
export function cjsDefaultInterop(): Plugin {
	return {
		name: "savvy:cjs-default-interop",
		renderChunk(code, chunk, outputOptions) {
			const format = (outputOptions as { format?: string }).format;
			if (format !== "cjs") return null;
			if (!chunk.isEntry) return null;
			const exportsList = chunk.exports;
			if (!Array.isArray(exportsList)) return null;
			if (!exportsList.includes("default")) return null;
			const hasNamed = exportsList.some((name) => name !== "default");
			if (!hasNamed) return null;
			return { code: `${code}\n${INTEROP_FOOTER}\n`, map: null };
		},
	};
}
