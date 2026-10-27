// Anchored module resolution for a Node process that loads SOMEONE ELSE'S copy
// of a package — a project's own `vitest`, the `chalk` Ink itself imports — and
// must notice when that copy is reinstalled underneath it.
//
// Node-only, published from `./node-sync` alone: it calls `createRequire`,
// `realpathSync` and `existsSync`, which `.` must never reach.

import { existsSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Option } from "effect";
import { requireResolve, toPath } from "./internal/anchor.js";

/**
 * Options for {@link ModuleResolution.resolve}.
 *
 * @public
 */
export interface ModuleResolveOptions {
	/**
	 * Where resolution starts, as the module at this location would resolve:
	 * a module URL (`import.meta.url`), a module file path, or a directory (an
	 * existing directory, or any path spelled with a trailing separator). A
	 * module file need not exist — only its directory matters.
	 */
	readonly from: string | URL;
	/**
	 * An ES-module resolver tried BEFORE CommonJS resolution — pass the calling
	 * module's own `import.meta.resolve`.
	 *
	 * @remarks
	 * `import.meta.resolve` always resolves relative to the module that owns it,
	 * so supply it only when `from` is that same module. It finds packages whose
	 * `exports` offer no `require` or `default` condition, which CommonJS
	 * resolution cannot. A throw — Vite's module runner ships an
	 * `import.meta.resolve` that throws "not supported" — falls through to
	 * CommonJS resolution from `from`, as does an answer that is not a `file:`
	 * URL (a `node:` built-in, a `data:` URL).
	 */
	readonly esm?: ((specifier: string) => string) | undefined;
	/**
	 * Pass the answer through `realpathSync`, resolving any symlink left in it.
	 * Defaults to `false`.
	 *
	 * @remarks
	 * Node's own resolvers already answer with the real path —
	 * `require.resolve` and `import.meta.resolve` both follow symlinks unless
	 * the process runs with `--preserve-symlinks` — so for a CommonJS answer, or
	 * Node's own `import.meta.resolve`, this changes nothing in an ordinary
	 * process. It matters only when the answer may still hold a symlink: under
	 * `--preserve-symlinks`, or when `esm` is a resolver that does not follow
	 * them. Node keys ES modules by real path, so the real path is the spelling
	 * that identifies the module instance another importer already holds.
	 */
	readonly realPath?: boolean | undefined;
}

/**
 * Options for {@link ModuleResolution.load}.
 *
 * @public
 */
export interface ModuleLoadOptions {
	/**
	 * The dynamic import to run — the test seam. Defaults to `(url) => import(url)`.
	 *
	 * @remarks
	 * A computed `import()` specifier defeats `vi.mock`, which intercepts only
	 * literal specifiers, so a test substitutes the importer instead of mocking
	 * the module.
	 */
	readonly importer?: ((url: string) => Promise<unknown>) | undefined;
}

const defaultImporter = (url: string): Promise<unknown> => import(/* @vite-ignore */ url);

/** An entry spelled as an absolute path or a `file:` URL, as its path; `undefined` for a bare specifier. */
const entryPath = (entry: string): string | undefined => {
	if (entry.startsWith("file:")) return toPath(entry);
	return entry.startsWith("/") || /^[A-Za-z]:[\\/]/.test(entry) || entry.startsWith("\\\\") ? entry : undefined;
};

/**
 * Anchored module resolution, stale-install detection and an injectable
 * loader, for a long-lived Node process that loads a project's own copy of a
 * package.
 *
 * @remarks
 * Published from `@effected/commands/node-sync` only. Every member is
 * synchronous except {@link ModuleResolution.load}, which is a dynamic import.
 *
 * @example
 * ```ts
 * import { ModuleResolution } from "@effected/commands/node-sync";
 * import { Option } from "effect";
 *
 * const entry = ModuleResolution.resolve("vitest/node", { from: projectRoot });
 * if (Option.isSome(entry) && !ModuleResolution.isStale(entry.value)) {
 *   const vitest = await ModuleResolution.load(entry.value);
 * }
 * ```
 *
 * @public
 */
export class ModuleResolution {
	private constructor() {}

	/**
	 * The absolute file path `specifier` resolves to from `options.from`, or
	 * `Option.none()` when it does not resolve there.
	 *
	 * @remarks
	 * ES-module resolution through `options.esm` is tried first when supplied;
	 * CommonJS resolution from `options.from` answers otherwise. Every failure
	 * — not installed, a subpath the package does not export, an unreadable
	 * manifest — is `Option.none()`: the caller's question is "can I load it
	 * from here", and each of those answers no. Never throws.
	 */
	static readonly resolve = (specifier: string, options: ModuleResolveOptions): Option.Option<string> => {
		let resolved: string | undefined;
		if (options.esm !== undefined) {
			try {
				const url = options.esm(specifier);
				if (url.startsWith("file:")) resolved = toPath(url);
			} catch {
				// Vite's module runner throws here; CommonJS resolution answers below.
			}
		}
		try {
			resolved ??= requireResolve(specifier, options.from);
			return Option.some(options.realPath === true ? realpathSync(resolved) : resolved);
		} catch {
			return Option.none();
		}
	};

	/**
	 * Whether a previously resolved `entry` is gone from disk — the install
	 * changed under a long-lived process (a lockfile regeneration renamed the
	 * package manager's store directory).
	 *
	 * @remarks
	 * `entry` is an absolute path or a `file:` URL; a bare specifier is not a
	 * location and is never stale. The check is on the exact path that would be
	 * imported, because a long-lived process's resolution caches can hand back
	 * a path that no longer exists.
	 */
	static readonly isStale = (entry: string): boolean => {
		const path = entryPath(entry);
		return path !== undefined && !existsSync(path);
	};

	/**
	 * Imports `entry` — an absolute path, a `file:` URL or a bare specifier —
	 * through `options.importer`.
	 *
	 * @remarks
	 * A path is converted to a `file:` URL first (`pathToFileURL`, so a Windows
	 * drive path imports correctly). The module namespace is returned as
	 * `unknown`: the caller narrows it, because nothing here can know its shape.
	 * Rejects as the importer rejects.
	 */
	static readonly load = (entry: string, options?: ModuleLoadOptions): Promise<unknown> => {
		const path = entry.startsWith("file:") ? undefined : entryPath(entry);
		const url = path === undefined ? entry : pathToFileURL(path).href;
		return (options?.importer ?? defaultImporter)(url);
	};
}
