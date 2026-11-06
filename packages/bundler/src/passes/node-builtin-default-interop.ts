// packages/bundler/src/passes/node-builtin-default-interop.ts
import { builtinModules } from "node:module";
import type { Plugin } from "rolldown";

/**
 * The set of Node built-in module names (without the `node:` prefix), e.g. `path`,
 * `process`, `fs`. Used to decide whether a BARE import specifier names a builtin.
 */
const BUILTIN_NAMES: ReadonlySet<string> = new Set(builtinModules);

/** True when `spec` resolves to a Node built-in module (either `node:x` or a bare builtin name). */
function isNodeBuiltin(spec: string): boolean {
	if (spec.startsWith("node:")) return true;
	return BUILTIN_NAMES.has(spec);
}

/**
 * Rewrite a default import / default re-export of a Node built-in into the
 * equivalent NAMESPACE form, so rolldown's CJS codegen produces correct interop.
 *
 * Why this exists — a rolldown 1.1.0 codegen defect (verified against the latest
 * published rolldown 1.1.0 / tsdown 0.22.2, with no newer release to upgrade to):
 *
 * ```ts
 * // SOURCE (e.g. vfile's lib/minproc.js)
 * export {default as minproc} from 'node:process'
 * // ...consumed as minproc.cwd()
 *
 * // rolldown CJS OUTPUT (BROKEN)
 * let node_process = require("node:process");
 * node_process.default.cwd()           // <- require("node:process").default is undefined
 * ```
 *
 * For a default import of an EXTERNAL Node builtin, rolldown emits a bare
 * `require("node:x")` WITHOUT its `__toESM` interop wrapper, yet still accesses
 * `.default` — which is `undefined` on a builtin's CJS export object, so the call
 * throws `Cannot read properties of undefined (reading 'cwd')` at runtime. NAMED
 * imports are unaffected (`(0, node_process.cwd)()` reads a real property), and a
 * NAMESPACE import is handled correctly: rolldown wraps it as
 * `node_process = __toESM(require("node:process"), 1)`, which synthesizes `.default`
 * and copies every own property, so member access works. This transform converts the
 * broken default form into the working namespace form BEFORE codegen, so it is immune
 * to minification and applies identically to per-module and bundled output.
 *
 * rolldown exposes no Rollup-style `output.interop` knob to fix this at the output
 * layer, which is why the correction happens here on the source.
 *
 * Rewrites (the two static forms that occur in practice, anchored to statement start):
 *
 * ```ts
 * import NAME from "node:x"            -> import * as NAME from "node:x"
 * export { default as NAME } from "node:x" -> export * as NAME from "node:x"
 * import NAME, { a, b } from "node:x"  -> import * as NAME from "node:x"; import { a, b } from "node:x"
 * ```
 *
 * The namespace binding NAME carries the builtin's named exports (`NAME.cwd`,
 * `NAME.join`, ...), which is exactly how a default import of a builtin is consumed
 * in practice. ESM output is unaffected at runtime (a namespace import of a builtin
 * resolves to the same members), so the plugin is safe to attach to dual builds.
 * @public
 */
export function nodeBuiltinDefaultInterop(): Plugin {
	// statement-start anchored (multiline): the leading group captures indentation/line-start
	// so a `import ... from "..."` appearing inside a string literal is not matched.
	const DEFAULT_REEXPORT =
		/(^|\n)([ \t]*)export\s*\{\s*default\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s*from\s*(["'])([^"']+)\4/g;
	const DEFAULT_WITH_NAMED = /(^|\n)([ \t]*)import\s+([A-Za-z_$][\w$]*)\s*,\s*(\{[^}]*\})\s*from\s*(["'])([^"']+)\5/g;
	const DEFAULT_IMPORT = /(^|\n)([ \t]*)import\s+([A-Za-z_$][\w$]*)\s+from\s*(["'])([^"']+)\4/g;

	return {
		name: "savvy:node-builtin-default-interop",
		transform(code) {
			// Fast bail: nothing to do unless the module imports/re-exports a builtin by name.
			if (!code.includes("node:") && !code.includes("from")) return null;
			let out = code;

			// export { default as NAME } from "node:x"  ->  export * as NAME from "node:x"
			out = out.replace(DEFAULT_REEXPORT, (match, lead, indent, name, quote, spec) =>
				isNodeBuiltin(spec) ? `${lead}${indent}export * as ${name} from ${quote}${spec}${quote}` : match,
			);

			// import NAME, { a, b } from "node:x"  ->  import * as NAME ... ; import { a, b } ...
			out = out.replace(DEFAULT_WITH_NAMED, (match, lead, indent, name, named, quote, spec) =>
				isNodeBuiltin(spec)
					? `${lead}${indent}import * as ${name} from ${quote}${spec}${quote};\n${indent}import ${named} from ${quote}${spec}${quote}`
					: match,
			);

			// import NAME from "node:x"  ->  import * as NAME from "node:x"
			out = out.replace(DEFAULT_IMPORT, (match, lead, indent, name, quote, spec) =>
				isNodeBuiltin(spec) ? `${lead}${indent}import * as ${name} from ${quote}${spec}${quote}` : match,
			);

			return out === code ? null : { code: out, map: null };
		},
	};
}
