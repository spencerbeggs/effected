/**
 * Reads markdownlint configuration files from disk (`.markdownlint.jsonc`,
 * `.json`, `.yaml`, `.yml`), follows `extends`, and resolves the
 * configuration that applies to a markdown file the way markdownlint-cli2
 * does. The package's only file-system surface: it requires `FileSystem` and
 * `Path` in `R`, and the package root never imports it.
 *
 * @packageDocumentation
 */

export type { ResolvedLintConfig } from "./MarkdownlintConfigFile.js";
export { MarkdownlintConfigError, MarkdownlintConfigFile } from "./MarkdownlintConfigFile.js";
