// packages/bundler/src/manifest/manifest-set.ts
import { PackageName } from "@effected/package-json";
import { ConfigValidationError } from "../errors.js";
import type { Json } from "./transform.js";

/**
 * Top-level keys the build or the release owns, each with the reason a config author reads when `set` names one.
 *
 * Every one is owned by something other than the config: the release tooling, the publish decision, the build's own
 * rewrite of the source manifest, or the always-stripped build-only fields. A string written over one would publish a
 * manifest that disagrees with what was built or released.
 *
 * @internal
 */
export const PROTECTED_KEYS: Readonly<Record<string, string>> = {
	version:
		"the version is owned by the release: changesets bump it, the release tags it and the API model's optimistic version reads it",
	private: 'publishability is derived from publishConfig.access, which "set" must not contradict',
	type: "the build emits ES modules as .js, which the module type has to keep loadable",
	exports: "the build rewrites the exports map to the files it emits",
	bin: "the build rewrites bin to the files it emits",
	files: "the build adds what it emits to files",
	main: "write an exports entry instead; the build emits from exports and bin",
	module: "write an exports entry instead; the build emits from exports and bin",
	types: "the build generates the declarations and points exports at them",
	typings: "the build generates the declarations and points exports at them",
	dependencies: "dependency maps are objects, and the build resolves their catalog: and workspace: specifiers",
	peerDependencies: "dependency maps are objects, and the build resolves their catalog: and workspace: specifiers",
	optionalDependencies: "dependency maps are objects, and the build resolves their catalog: and workspace: specifiers",
	devDependencies: "always stripped from the emitted manifest",
	bundleDependencies: "always stripped from the emitted manifest",
	bundledDependencies: "always stripped from the emitted manifest",
	scripts: "always stripped from the emitted manifest",
	publishConfig: "always stripped from the emitted manifest; publish targets are read from the source manifest",
	packageManager: "always stripped from the emitted manifest",
	devEngines: "always stripped from the emitted manifest",
};

/**
 * The top-level keys `set` may write: those npm's package.json reference documents as taking a string, alone or as
 * one accepted form, and that nothing in the build or the release owns.
 *
 * @remarks
 * `name`, `description`, `homepage` and `license` are strings. `author`, `bugs`, `funding` and `repository` each also
 * take a string shorthand (`"Name <email> (url)"`, an issues URL, a funding URL, `"github:owner/repo"`). `browser`
 * takes a string replacement for `main`, and `man` a single page's path. Every other documented key is a boolean, an
 * array or an object (`sideEffects`, `keywords`, `os`, `cpu`, `engines`, `imports`, `workspaces`, ...), so a string
 * written over it would publish a value of the wrong type, and an undocumented key has no type to check.
 *
 * @internal
 */
export const STRING_KEYS: ReadonlyArray<string> = [
	"name",
	"description",
	"homepage",
	"license",
	"author",
	"bugs",
	"funding",
	"repository",
	"browser",
	"man",
];

const setError = (key: string, reason: string): ConfigValidationError =>
	new ConfigValidationError({ path: `manifest.set.${key}`, reason });

/**
 * Refuse a `[package.build.manifest] set` table the build could not honour: a protected key, a key package.json does
 * not type as a string, a key also listed in `drop`, an empty key, or a `name` npm would not accept.
 *
 * @internal
 */
export function validateManifestSet(set: Readonly<Record<string, string>>, drop: ReadonlyArray<string>): void {
	for (const [key, value] of Object.entries(set)) {
		if (key.length === 0) throw setError('""', "a manifest key cannot be empty");
		const reason = PROTECTED_KEYS[key];
		if (reason !== undefined) throw setError(key, `"${key}" cannot be set: ${reason}`);
		if (!STRING_KEYS.includes(key)) {
			throw setError(
				key,
				`"${key}" cannot be set: set writes only keys package.json types as a string (${STRING_KEYS.join(", ")})`,
			);
		}
		if (drop.includes(key)) {
			throw setError(key, `"${key}" is both set and listed in manifest.drop; keep one`);
		}
		if (key === "name" && !PackageName.isValid(value)) {
			throw setError(key, `"${value}" is not a valid npm package name`);
		}
	}
}

/**
 * The package name every emitted manifest, `targets.json` group and API model carries: `set.name` when written,
 * otherwise the source manifest's.
 *
 * @internal
 */
export const emittedPackageName = (set: Readonly<Record<string, string>>, sourceName: string): string =>
	set.name ?? sourceName;

/**
 * Write the `set` keys other than `name` over an emitted manifest. `name` reaches the manifest through the publish
 * group, so a target's own name override still wins for its group. Pure: returns a copy.
 *
 * @internal
 */
export function applyManifestSet(pkg: Json, set: Readonly<Record<string, string>> | undefined): Json {
	if (set === undefined) return pkg;
	const out: Json = { ...pkg };
	for (const [key, value] of Object.entries(set)) {
		if (key !== "name") out[key] = value;
	}
	return out;
}
