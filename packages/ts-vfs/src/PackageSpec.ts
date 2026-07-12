import { Option, Schema } from "effect";

/**
 * Node.js built-in base module names, used by
 * {@link PackageSpec.normalizeSpecifier} to map built-in specifiers to the
 * `node` types package. Matched against the specifier's FIRST path segment,
 * so every built-in subpath (`fs/promises`, `readline/promises`,
 * `util/types`, …) normalizes without enumerating them.
 */
const NODE_BUILTINS: ReadonlySet<string> = new Set([
	"assert",
	"async_hooks",
	"buffer",
	"child_process",
	"cluster",
	"console",
	"constants",
	"crypto",
	"dgram",
	"diagnostics_channel",
	"dns",
	"domain",
	"events",
	"fs",
	"http",
	"http2",
	"https",
	"inspector",
	"module",
	"net",
	"os",
	"path",
	"perf_hooks",
	"process",
	"punycode",
	"querystring",
	"readline",
	"repl",
	"stream",
	"string_decoder",
	"timers",
	"tls",
	"trace_events",
	"tty",
	"url",
	"util",
	"v8",
	"vm",
	"wasi",
	"worker_threads",
	"zlib",
]);

/**
 * A single name segment: no separators, no `@`, no whitespace, no cache-key
 * or URL delimiters (`:` is the cacheKey delimiter — a version containing it
 * would defeat `parseCacheKey`; `?`/`#` would truncate CDN URLs), and not a
 * relative path component. Deliberately lenient beyond that — the CDN serves
 * every historical malformation npm ever published — but strict enough that a
 * name or version can never escape its cache directory when joined into a
 * path.
 */
const SAFE_SEGMENT = /^(?!\.{1,2}$)[^/\\@\s:?#]+$/;

/** `name` or `@scope/name`, each segment {@link SAFE_SEGMENT}-shaped. */
const NAME_PATTERN = /^(@(?!\.{1,2}\/)[^/\\@\s:?#]+\/)?(?!\.{1,2}$)[^/\\@\s:?#]+$/;

/**
 * Identifies a package at a version reference.
 *
 * @remarks
 * `version` is the reference **as requested** — an exact version, a range or
 * a dist-tag — and is pinned later by `TypeRegistry.resolveVersion`. Both
 * fields are validated just enough that they can never traverse outside a
 * cache directory when joined into a path; otherwise validation is lenient
 * (CDN reality).
 *
 * Construct via `PackageSpec.make({ name, version })` or
 * {@link PackageSpec.fromString} — never `new`.
 *
 * @example
 * ```ts
 * import { PackageSpec } from "@effected/ts-vfs";
 *
 * const pkg = PackageSpec.fromString("zod@3.23.8");
 * console.log(pkg.name, pkg.version, pkg.cacheKey);
 * // => "zod" "3.23.8" "zod:3.23.8"
 * ```
 *
 * @public
 */
export class PackageSpec extends Schema.Class<PackageSpec>("PackageSpec")({
	/** The npm package name (e.g. `"zod"`, `"@effect/schema"`). */
	name: Schema.String.check(Schema.isPattern(NAME_PATTERN)),
	/** The version reference as requested: exact, range, or dist-tag. */
	version: Schema.String.check(Schema.isPattern(SAFE_SEGMENT)),
}) {
	/**
	 * Parse a `name@version` specifier (`"zod@3.23.8"`, `"@scope/pkg@^1.0.0"`).
	 *
	 * @remarks
	 * A specifier without a version part defaults to `"latest"`. An invalid
	 * specifier is developer wiring, not input — it throws (defect posture),
	 * exactly like `PackageSpec.make` with invalid fields.
	 */
	static fromString(spec: string): PackageSpec {
		const at = spec.lastIndexOf("@");
		if (at > 0) {
			return PackageSpec.make({ name: spec.slice(0, at), version: spec.slice(at + 1) });
		}
		return PackageSpec.make({ name: spec, version: "latest" });
	}

	/**
	 * Extract the npm package name from an arbitrary import specifier.
	 *
	 * @remarks
	 * `node:` specifiers and Node built-ins normalize to `"node"` (the
	 * `@types/node` convention); scoped specifiers keep scope and name but drop
	 * deep-import segments; bare specifiers keep only the first path segment.
	 *
	 * @example
	 * ```ts
	 * import { PackageSpec } from "@effected/ts-vfs";
	 *
	 * PackageSpec.normalizeSpecifier("node:fs");                // "node"
	 * PackageSpec.normalizeSpecifier("@effect/platform/Http"); // "@effect/platform"
	 * PackageSpec.normalizeSpecifier("lodash/fp");              // "lodash"
	 * ```
	 */
	static normalizeSpecifier(specifier: string): string {
		if (specifier.startsWith("node:")) return "node";
		if (specifier.startsWith("@")) {
			const parts = specifier.split("/");
			if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
			return specifier;
		}
		const firstSlash = specifier.indexOf("/");
		const base = firstSlash === -1 ? specifier : specifier.slice(0, firstSlash);
		// Base-segment match so built-in subpaths (`readline/promises`,
		// `util/types`, …) normalize without enumerating each one.
		if (NODE_BUILTINS.has(base)) return "node";
		return base;
	}

	/**
	 * Parse a {@link PackageSpec.cacheKey} back into a spec.
	 *
	 * @remarks
	 * Scoped keys (leading `@`) have three colon segments, unscoped keys two.
	 * `Option.none()` for keys matching neither shape — the metadata store may
	 * hold keys this package never wrote.
	 */
	static parseCacheKey(key: string): Option.Option<PackageSpec> {
		const parts = key.split(":");
		const candidate = key.startsWith("@")
			? parts.length === 3
				? { name: `${parts[0]}/${parts[1]}`, version: parts[2] }
				: undefined
			: parts.length === 2
				? { name: parts[0], version: parts[1] }
				: undefined;
		// The store may hold keys this package never wrote, so a mis-shaped key
		// is data, not a defect — validate before constructing.
		if (candidate === undefined || !NAME_PATTERN.test(candidate.name) || !SAFE_SEGMENT.test(candidate.version)) {
			return Option.none();
		}
		return Option.some(PackageSpec.make(candidate));
	}

	/** The `name@version` string form. */
	override toString(): string {
		return `${this.name}@${this.version}`;
	}

	/**
	 * The colon-delimited metadata-store key: `@scope:name:version` for scoped
	 * packages, `name:version` otherwise.
	 *
	 * @remarks
	 * The scheme mirrors v3's on-disk layout but there is no compat contract
	 * with databases written by `type-registry-effect` — nothing was published.
	 */
	get cacheKey(): string {
		return this.name.startsWith("@")
			? `${this.name.replace("/", ":")}:${this.version}`
			: `${this.name}:${this.version}`;
	}
}
