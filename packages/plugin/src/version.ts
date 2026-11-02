/**
 * This package's own version, which each bin shim passes to its front end as
 * `distribution.version` beside `distribution.name: "@effected/plugin"`. The
 * bundler replaces the exact expression `process.env.__PACKAGE_VERSION__` with
 * the package version at build time, so it must stay spelled this way;
 * `"0.0.0"` is the unbuilt-source fallback.
 *
 * @public
 */
export const PLUGIN_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
