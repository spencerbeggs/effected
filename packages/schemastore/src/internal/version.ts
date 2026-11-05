// The one module that reads the build-time version. The bundler replaces the
// exact expression `process.env.__PACKAGE_VERSION__`, so it must stay spelled
// that way; an unbuilt source run gets the "0.0.0" fallback, which the engine's
// version comparison skips.

/**
 * This copy's package version.
 *
 * @internal
 */
export const VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";

/**
 * The key a version stamp lives under. `Symbol.for`, so a copy of this package
 * reads a stamp another copy wrote.
 *
 * @internal
 */
export const VERSION_STAMP: unique symbol = Symbol.for("@effected/schemastore/version");

/**
 * Stamp `target` with this copy's version. Non-enumerable, which keeps the stamp
 * out of structural equality, `Schema` encoding and object spread.
 *
 * @internal
 */
export const stampVersion = <T extends object>(target: T): T =>
	Object.defineProperty(target, VERSION_STAMP, { value: VERSION });
