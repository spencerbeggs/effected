/**
 * The `effected` command's version. The bundler replaces the exact expression
 * `process.env.__PACKAGE_VERSION__` with the package version at build time, so
 * it must stay spelled this way.
 *
 * @public
 */
export const CLI_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
