import { Option, Schema } from "effect";
import {
	compileWildcard,
	extractTypesFromExport,
	findMainTypePath,
	getExportValue,
	isSafeRelativePath,
	isTypeDefinition,
	normalizePath,
} from "./internal/resolution.js";
import type { PackageManifest } from "./PackageFetcher.js";
import { PackageSpec } from "./PackageSpec.js";

/**
 * A resolved module: the declaration file a specifier resolves to within a
 * package.
 *
 * @public
 */
export class ResolvedModule extends Schema.Class<ResolvedModule>("ResolvedModule")({
	/** The file path relative to the package root (no `./` prefix). */
	filePath: Schema.String,
	/** Whether the path names a TypeScript declaration file. */
	isTypeDefinition: Schema.Boolean,
	/** The package the path belongs to. */
	package: PackageSpec,
}) {}

const DUNDER_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Build a `ResolvedModule` only when the manifest-supplied path stays inside
 * the package: resolved paths reach `PackageFetcher.downloadFile`'s URL and
 * the cache's join, so an absolute or `..`-bearing path from a hostile
 * manifest must not survive resolution.
 */
const safeResolved = (filePath: string, pkg: PackageSpec): Option.Option<ResolvedModule> => {
	const normalized = normalizePath(filePath.replace(/^\.\//, ""));
	if (!isSafeRelativePath(normalized)) return Option.none();
	return Option.some(
		ResolvedModule.make({
			filePath: normalized,
			isTypeDefinition: isTypeDefinition(normalized),
			package: pkg,
		}),
	);
};

/**
 * Pure `package.json` → declaration-file resolution.
 *
 * @remarks
 * Stateless pure functions — no service, no layer (v3's `Layer.succeed` over
 * stateless functions was ceremony), and no fictional error channel: v3
 * declared a `ResolutionError` its total implementation could never raise.
 * Here {@link TypeResolver.resolveImport} is honest in the other direction
 * too — it returns `Option.none()` where v3 fabricated a guessed fallback
 * path, leaving fallback policy to the caller.
 *
 * All map inputs are untrusted CDN data; the machinery underneath is depth-
 * guarded, wildcard-bounded and prototype-pollution-safe (see
 * `internal/resolution.ts`), and every resolved path is validated to stay
 * inside the package before a `ResolvedModule` is constructed.
 *
 * @public
 */
export class TypeResolver {
	private constructor() {}

	/**
	 * Resolve an import specifier (`"zod"`, `"zod/lib/types"`) against a
	 * manifest.
	 *
	 * @remarks
	 * Resolution order: the `exports` map (`types` condition, then
	 * `import`/`default`, fallback arrays in order), then `typesVersions["*"]`
	 * (exact, then bounded wildcards), then — for the root specifier only —
	 * the top-level `types`/`typings` fields. `Option.none()` when the
	 * manifest offers no evidence for the subpath, or when the evidence names
	 * a path outside the package (hostile manifest — fails closed).
	 */
	static resolveImport(specifier: string, manifest: PackageManifest, pkg: PackageSpec): Option.Option<ResolvedModule> {
		// A name-prefix match must sit on a path boundary: `pkg2` is NOT
		// `pkg` + subpath `2`.
		let subpath: string;
		if (specifier === pkg.name) {
			subpath = ".";
		} else if (specifier.startsWith(`${pkg.name}/`)) {
			subpath = `./${specifier.slice(pkg.name.length + 1)}`;
		} else {
			const bare = specifier.replace(/^\/+/, "");
			subpath = bare === "" || bare === "." ? "." : bare.startsWith("./") ? bare : `./${bare}`;
		}

		if (manifest.exports !== undefined) {
			const exportValue = getExportValue(manifest.exports, subpath);
			const typesPath = extractTypesFromExport(exportValue);
			if (typesPath !== null) return safeResolved(typesPath, pkg);
		}

		if (manifest.typesVersions !== undefined && Object.hasOwn(manifest.typesVersions, "*")) {
			const versionMap = manifest.typesVersions["*"];
			if (versionMap !== undefined) {
				const lookupPath = subpath === "." ? "." : subpath.replace(/^\.\//, "");
				if (!DUNDER_KEYS.has(lookupPath) && Object.hasOwn(versionMap, lookupPath)) {
					const mapped = versionMap[lookupPath];
					const first = Array.isArray(mapped) ? mapped[0] : mapped;
					if (typeof first === "string") return safeResolved(first, pkg);
				}
				for (const pattern of Object.keys(versionMap)) {
					if (DUNDER_KEYS.has(pattern) || !pattern.includes("*")) continue;
					if (!Object.hasOwn(versionMap, pattern)) continue;
					const regex = compileWildcard(pattern);
					if (regex === null) continue;
					const match = regex.exec(lookupPath);
					if (match === null) continue;
					const mapped = versionMap[pattern];
					const first = Array.isArray(mapped) ? mapped[0] : mapped;
					if (typeof first === "string") {
						return safeResolved(first.replace(/\*/g, match[1] ?? ""), pkg);
					}
				}
			}
		}

		if (subpath === ".") {
			if (manifest.types !== undefined) return safeResolved(manifest.types, pkg);
			if (manifest.typings !== undefined) return safeResolved(manifest.typings, pkg);
		}

		return Option.none();
	}

	/**
	 * Resolve the manifest's main type entry.
	 *
	 * @remarks
	 * Total by the documented `index.d.ts` convention floor: `types`/`typings`,
	 * then the root export's types condition, then a declaration-extension
	 * swap of `main`, then `index.d.ts`. A main path that escapes the package
	 * (hostile manifest) also falls to the floor rather than surviving.
	 */
	static resolveMainEntry(manifest: PackageManifest, pkg: PackageSpec): ResolvedModule {
		return Option.getOrElse(safeResolved(findMainTypePath(manifest), pkg), () =>
			ResolvedModule.make({ filePath: "index.d.ts", isTypeDefinition: true, package: pkg }),
		);
	}

	/**
	 * Enumerate every entry point that exposes type definitions: the main
	 * entry plus each `exports` subpath with a types-bearing condition,
	 * deduplicated by file path.
	 *
	 * @remarks
	 * Wildcard export keys (`"./*"`) are skipped: enumeration has no captured
	 * segment to substitute, so a pattern entry would emit a literal
	 * `dist/*.d.ts`. Pattern subpaths resolve through
	 * {@link TypeResolver.resolveImport}, which has the concrete specifier.
	 * Entries whose paths escape the package are skipped.
	 */
	static resolveTypeEntries(manifest: PackageManifest, pkg: PackageSpec): ReadonlyArray<ResolvedModule> {
		const entries: Array<ResolvedModule> = [TypeResolver.resolveMainEntry(manifest, pkg)];

		if (manifest.exports !== undefined && typeof manifest.exports === "object" && !Array.isArray(manifest.exports)) {
			for (const key of Object.keys(manifest.exports)) {
				if (DUNDER_KEYS.has(key)) continue;
				if (!key.startsWith(".")) continue;
				if (key.includes("*")) continue;
				if (!Object.hasOwn(manifest.exports, key)) continue;
				const typesPath = extractTypesFromExport((manifest.exports as Record<string, unknown>)[key]);
				if (typesPath !== null) {
					const entry = safeResolved(typesPath, pkg);
					if (Option.isSome(entry)) entries.push(entry.value);
				}
			}
		}

		const seen = new Set<string>();
		return entries.filter((entry) => {
			if (seen.has(entry.filePath)) return false;
			seen.add(entry.filePath);
			return true;
		});
	}

	/**
	 * The conventional declaration-file path for a JavaScript file path
	 * (`lib/index.js` → `lib/index.d.ts`, `.mjs` → `.d.mts`, `.cjs` →
	 * `.d.cts`).
	 *
	 * @remarks
	 * The input is a tree path from the CDN — untrusted — so a path that is
	 * absolute or escapes the package yields `Option.none()` instead of a
	 * `ResolvedModule` that could reach a download URL.
	 */
	static findTypeDefinition(jsFilePath: string, pkg: PackageSpec): Option.Option<ResolvedModule> {
		let typePath: string;
		if (jsFilePath.endsWith(".mjs")) typePath = jsFilePath.replace(/\.mjs$/, ".d.mts");
		else if (jsFilePath.endsWith(".cjs")) typePath = jsFilePath.replace(/\.cjs$/, ".d.cts");
		else if (jsFilePath.endsWith(".js")) typePath = jsFilePath.replace(/\.js$/, ".d.ts");
		else typePath = `${jsFilePath.replace(/\.(m?js|cjs)$/, "")}.d.ts`;
		return safeResolved(typePath, pkg);
	}
}
