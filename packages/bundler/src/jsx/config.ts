import type { CompilerOptions } from "@effected/tsconfig-json";
import { JsxConfig as KitJsxConfig, TsconfigLoader } from "@effected/tsconfig-json";
import { Effect, FileSystem, Option, Path } from "effect";

/**
 * Resolved JSX transform settings. The shape mirrors the subset of rolldown's JsxOptions, but the
 * bundler consumes it to populate the generated dts tsconfig's `jsx`/`jsxImportSource`, not by
 * forwarding it into rolldown's input options.
 *
 * @public
 */
export interface JsxConfig {
	/** "automatic" auto-imports the JSX factories (react-jsx); "classic" does not (React.createElement). */
	readonly runtime?: "classic" | "automatic" | undefined;
	/** The JSX import source for the automatic runtime (e.g. "react", "preact"). */
	readonly importSource?: string | undefined;
}

/**
 * The jsx-relevant slice of a tsconfig's compilerOptions.
 *
 * @public
 */
export interface TsconfigJsx {
	readonly jsx?: string | undefined;
	readonly jsxImportSource?: string | undefined;
}

/**
 * Resolve the effective JSX config: an explicit override wins; otherwise infer from the tsconfig
 * values via `@effected/tsconfig-json`'s `JsxConfig.fromCompilerOptions`. Returns undefined when
 * no JSX transform is needed (preserve/none).
 * @public
 */
export function resolveJsxConfig(tsconfig: TsconfigJsx, override: JsxConfig | undefined): JsxConfig | undefined {
	if (override !== undefined) {
		return override.runtime === "automatic"
			? { runtime: "automatic", importSource: override.importSource ?? "react" }
			: override;
	}
	// The kit's projection implements the same mapping this module used to hand-roll:
	// react-jsx/react-jsxdev -> automatic (importSource ?? "react"); react -> classic; else None.
	const inferred = KitJsxConfig.fromCompilerOptions({
		...(tsconfig.jsx !== undefined ? { jsx: tsconfig.jsx } : {}),
		...(tsconfig.jsxImportSource !== undefined ? { jsxImportSource: tsconfig.jsxImportSource } : {}),
	} as CompilerOptions.Type);
	return Option.match(inferred, {
		onNone: () => undefined,
		onSome: (cfg): JsxConfig => ({
			runtime: cfg.runtime,
			...(cfg.importSource !== undefined ? { importSource: cfg.importSource } : {}),
		}),
	});
}

/**
 * Read the jsx-relevant compilerOptions from a package's own tsconfig.json (best-effort;
 * answers empty on absence or on a read or parse failure; a loader defect is not swallowed). Resolved through `@effected/tsconfig-json`'s
 * loader, so JSONC syntax and `extends` chains are honored.
 * @public
 */
export const readTsconfigJsx: (cwd: string) => Effect.Effect<TsconfigJsx, never, FileSystem.FileSystem | Path.Path> =
	Effect.fnUntraced(function* (cwd) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const file = path.join(cwd, "tsconfig.json");
		if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) return {};
		return yield* TsconfigLoader.compilerOptions(file).pipe(
			Effect.map(
				(co): TsconfigJsx => ({
					...(co.jsx !== undefined ? { jsx: co.jsx } : {}),
					...(co.jsxImportSource !== undefined ? { jsxImportSource: co.jsxImportSource } : {}),
				}),
			),
			Effect.orElseSucceed((): TsconfigJsx => ({})),
		);
	});
