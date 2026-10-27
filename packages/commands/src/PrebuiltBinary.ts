// The esbuild / biome / turbo distribution pattern: a thin package declares one
// `optionalDependencies` entry per platform, the package manager installs only
// the one matching the host, and the thin package resolves that platform
// package's binary at runtime.
//
// The resolution core here is pure over a CALLER-SUPPLIED host — the target
// and a `require.resolve`-shaped function — so it imports nothing platform-
// shaped. `@effected/commands/node-sync`'s `nodePrebuiltHost(import.meta.url)`
// binds it to Node, anchored at the caller's module: `require.resolve` finds an
// optional dependency only from inside the package that declares it.

import { Result, Schema } from "effect";
import { ChildProcess } from "effect/process";
import { errorCode } from "./internal/errorCode.js";

/**
 * The host a prebuilt binary must match.
 *
 * @public
 */
export interface PrebuiltTarget {
	/** The operating system, as `process.platform` spells it (`"darwin"`, `"linux"`, `"win32"`). */
	readonly platform: string;
	/** The CPU architecture, as `process.arch` spells it (`"arm64"`, `"x64"`). */
	readonly arch: string;
	/** The C library on Linux, when known; absent elsewhere. */
	readonly libc?: "glibc" | "musl" | undefined;
}

/**
 * Which package carries the binary for each target, and where in it the binary sits.
 *
 * @public
 */
export interface PrebuiltBinarySpec {
	/**
	 * Target key to the optional-dependency package that carries it. A key is
	 * `${platform}-${arch}` or, for a libc-specific build,
	 * `${platform}-${arch}-${libc}` (`"linux-x64-musl"`).
	 */
	readonly packages: Readonly<Record<string, string>>;
	/**
	 * The binary's subpath inside the package (`"bin/esbuild"`), or a function
	 * of the target for per-platform names (`.exe` on win32). Absent, the
	 * package's own `"."` export is the binary.
	 */
	readonly binary?: string | ((target: PrebuiltTarget) => string) | undefined;
}

/**
 * The platform facts and module resolution `PrebuiltBinary.resolveSync`
 * runs against — `nodePrebuiltHost` from `@effected/commands/node-sync` on Node.
 *
 * @public
 */
export interface PrebuiltHost {
	/** The host to match. */
	readonly target: PrebuiltTarget;
	/**
	 * Resolves a specifier to an absolute file path from inside the package that
	 * declares the optional dependencies, throwing like `require.resolve`: an
	 * error whose `code` is `"MODULE_NOT_FOUND"` means not installed.
	 */
	readonly resolve: (specifier: string) => string;
}

/**
 * Why a prebuilt binary could not be resolved.
 *
 * @public
 */
export const PrebuiltBinaryReason = Schema.Literals([
	"unsupportedTarget",
	"notInstalled",
	"binaryMissing",
	"unresolvable",
]);

/**
 * The decoded type of {@link (PrebuiltBinaryReason:variable)}.
 *
 * @public
 */
export type PrebuiltBinaryReason = typeof PrebuiltBinaryReason.Type;

/**
 * No usable prebuilt binary for this host.
 *
 * @remarks
 * `reason` routes: `"unsupportedTarget"` — no package is published for any of
 * `candidates`; `"notInstalled"` — the matching package is absent (installed
 * with optional dependencies omitted, or a lockfile from another platform);
 * `"binaryMissing"` — the package is installed but holds no file at the binary
 * subpath, or at its `"."` export when no subpath is given (a partial
 * extraction, or a spec naming the wrong path);
 * `"unresolvable"` — the package is present but resolution failed some other
 * way (a subpath it does not export, an unreadable manifest), which is a
 * packaging fault, carried in `cause`. When several candidate keys are
 * declared, the error describes the most actionable failure among them.
 *
 * @public
 */
export class PrebuiltBinaryError extends Schema.TaggedError<PrebuiltBinaryError>()("PrebuiltBinaryError", {
	/** Why. */
	reason: PrebuiltBinaryReason,
	/** The target keys looked up, most specific first. */
	candidates: Schema.Array(Schema.String),
	/** The package that matched, when one did. */
	packageName: Schema.optionalKey(Schema.String),
	/** The underlying resolution failure, for `"notInstalled"` and `"unresolvable"`. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		const target = this.candidates[0] ?? "this platform";
		if (this.reason === "unsupportedTarget") {
			return `No prebuilt binary is published for ${this.candidates.join(" or ")}`;
		}
		if (this.reason === "notInstalled") {
			return `The prebuilt binary package ${this.packageName ?? ""} for ${target} is not installed; reinstall without omitting optional dependencies`;
		}
		if (this.reason === "binaryMissing") {
			return `The prebuilt binary package ${this.packageName ?? ""} for ${target} is installed but contains no binary at the expected path`;
		}
		return `The prebuilt binary package ${this.packageName ?? ""} for ${target} is installed but its binary cannot be resolved`;
	}
}

/**
 * A resolved prebuilt binary.
 *
 * @public
 */
export class ResolvedPrebuilt extends Schema.Class<ResolvedPrebuilt>("ResolvedPrebuilt")({
	/** Absolute path of the binary. */
	path: Schema.String,
	/** The platform package it came from. */
	packageName: Schema.String,
	/** The target key that matched. */
	key: Schema.String,
}) {
	/** A core `Command` running the binary with `args` — no shell, no launcher prefix. */
	command(...args: ReadonlyArray<string>): ChildProcess.Command {
		return ChildProcess.make(this.path, args);
	}
}

/**
 * Whether `packageName` is installed at all, judged by resolving its manifest
 * and then its root: any answer other than `MODULE_NOT_FOUND` — success, or
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` from an `exports` map — means the package
 * directory was found.
 */
const isInstalled = (host: PrebuiltHost, packageName: string): boolean => {
	for (const specifier of [`${packageName}/package.json`, packageName]) {
		try {
			host.resolve(specifier);
			return true;
		} catch (error) {
			if (errorCode(error) !== "MODULE_NOT_FOUND") return true;
		}
	}
	return false;
};

/**
 * Resolution of the platform-specific binary an `optionalDependencies` fan-out ships.
 *
 * @public
 */
export class PrebuiltBinary {
	private constructor() {}

	/**
	 * The target keys a host matches, most specific first: the libc-specific
	 * key when the libc is known, then the generic `${platform}-${arch}`.
	 */
	static readonly candidates = (target: PrebuiltTarget): ReadonlyArray<string> => {
		const generic = `${target.platform}-${target.arch}`;
		return target.libc === undefined ? [generic] : [`${generic}-${target.libc}`, generic];
	};

	/**
	 * Resolves the binary for `host.target` from `spec`.
	 *
	 * @remarks
	 * Synchronous over the caller-supplied host, so it runs where no Effect
	 * runtime does (config evaluation, a Node SEA sidecar). Candidate keys are
	 * tried most specific first — the libc-specific package, then the generic
	 * one — and the first that RESOLVES wins: a declared libc-specific package
	 * that is not installed falls back to the generic package. It fails only
	 * when no declared candidate resolves, describing the most actionable
	 * failure (a present-but-broken package over an absent one). A
	 * `MODULE_NOT_FOUND` reads as `"notInstalled"`, or as `"binaryMissing"` when
	 * the package itself is installed and only the binary is absent — whether
	 * the binary is a subpath or the package's own `"."` export; any other
	 * resolution failure is `"unresolvable"`.
	 *
	 * @example
	 * ```ts
	 * import { PrebuiltBinary } from "@effected/commands";
	 * import { nodePrebuiltHost } from "@effected/commands/node-sync";
	 *
	 * const binary = PrebuiltBinary.resolveSync(
	 *   { packages: { "darwin-arm64": "@acme/cli-darwin-arm64", "linux-x64": "@acme/cli-linux-x64" }, binary: "bin/acme" },
	 *   nodePrebuiltHost(import.meta.url),
	 * );
	 * ```
	 */
	static readonly resolveSync = (
		spec: PrebuiltBinarySpec,
		host: PrebuiltHost,
	): Result.Result<ResolvedPrebuilt, PrebuiltBinaryError> => {
		const candidates = PrebuiltBinary.candidates(host.target);
		const subpath = typeof spec.binary === "function" ? spec.binary(host.target) : spec.binary;
		const failures: Array<PrebuiltBinaryError> = [];
		for (const key of candidates) {
			// Own keys only: a target key must never pick up an inherited property.
			const packageName = Object.hasOwn(spec.packages, key) ? spec.packages[key] : undefined;
			if (packageName === undefined) continue;
			const specifier = subpath === undefined || subpath === "" ? packageName : `${packageName}/${subpath}`;
			try {
				return Result.succeed(ResolvedPrebuilt.make({ path: host.resolve(specifier), packageName, key }));
			} catch (cause) {
				// A `MODULE_NOT_FOUND` for the binary's own specifier — a subpath, or the
				// package's `"."` export when the package IS the binary — is absence of the
				// package only when its manifest is absent too.
				const reason =
					errorCode(cause) !== "MODULE_NOT_FOUND"
						? "unresolvable"
						: isInstalled(host, packageName)
							? "binaryMissing"
							: "notInstalled";
				failures.push(new PrebuiltBinaryError({ reason, candidates, packageName, cause }));
			}
		}
		if (failures.length === 0) return Result.fail(new PrebuiltBinaryError({ reason: "unsupportedTarget", candidates }));
		// A present-but-broken package says more than an absent one.
		return Result.fail(
			failures.find((failure) => failure.reason !== "notInstalled") ?? (failures[0] as PrebuiltBinaryError),
		);
	};
}
