import type { Plugin } from "rolldown";

const STUB_PREFIX = "\0effected-action-ignore:";

/**
 * Replaces each ignored package with a virtual module that throws when it is loaded.
 *
 * @remarks
 * A guarded `require` or `import()` of the package then sees it as unavailable. The module is virtual and its id names
 * only the package, so no path reaches the bundle and the output does not depend on where it is built.
 */
export const ignoreStubPlugin = (ignored: ReadonlyArray<string>): Plugin => ({
	name: "effected-action-ignore",
	resolveId(source) {
		return ignored.includes(source) ? { id: `${STUB_PREFIX}${source}`, moduleSideEffects: true } : null;
	},
	load(id) {
		if (!id.startsWith(STUB_PREFIX)) return null;
		const message = `${id.slice(STUB_PREFIX.length)} is excluded via the build 'ignore' option and was loaded at runtime.`;
		return `throw new Error(${JSON.stringify(message)});\n`;
	},
});
