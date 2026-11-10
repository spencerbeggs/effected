import { Yaml } from "@effected/yaml";
import { Effect, Result, Schema } from "effect";
import { ReleaseType } from "./BumpType.js";
import { ChangesetParseError } from "./errors.js";

/**
 * One parsed changeset: the packages it releases and its summary text.
 *
 * @public
 */
export class ParsedChangeset extends Schema.Class<ParsedChangeset>("ParsedChangeset")({
	/** Package name to requested release type, in file order. */
	releases: Schema.ReadonlyMap(Schema.String, ReleaseType),
	/** The markdown after the front matter, trimmed as `@changesets/parse` trims it. */
	summary: Schema.String,
}) {}

const Releases = Schema.Record(Schema.String, ReleaseType);
const decodeReleases = Schema.decodeUnknownResult(Releases);

const fail = (reason: string, line?: number): Result.Result<never, ChangesetParseError> =>
	Result.fail(new ChangesetParseError({ reason, ...(line === undefined ? {} : { line }) }));

const parseText = (text: string): Result.Result<ParsedChangeset, ChangesetParseError> => {
	const lines = text.split("\n");
	const isFence = (line: string | undefined): boolean => line !== undefined && line.replace(/\r$/, "") === "---";
	if (!isFence(lines[0])) return fail("missing front matter: the file must start with a --- line", 1);
	const close = lines.findIndex((line, index) => index > 0 && isFence(line));
	if (close === -1) return fail("unterminated front matter: no closing --- line", 1);

	const block = lines.slice(1, close).join("\n");
	const rest = lines.slice(close + 1).join("\n");
	// Trimmed, as `@changesets/parse` trims it.
	const summary = rest.trim();

	const value = block.trim() === "" ? Result.succeed({}) : Yaml.parseResult(block);
	return Result.match(value, {
		onFailure: (error) =>
			fail(`front matter is not valid YAML: ${error.message}`, (error.diagnostics[0]?.line ?? 0) + 2),
		onSuccess: (parsed) =>
			Result.match(decodeReleases(parsed ?? {}), {
				onFailure: (error) =>
					fail(`front matter must map package names to patch, minor, major or none: ${error.message}`, 2),
				onSuccess: (releases) =>
					Result.succeed(ParsedChangeset.make({ releases: new Map(Object.entries(releases)), summary })),
			}),
	});
};

/**
 * Parsing a changeset markdown file: YAML front matter mapping package names
 * to release types, then the summary.
 *
 * @public
 */
export class ChangesetFile {
	/**
	 * Parse a changeset synchronously.
	 *
	 * @param text - The file contents.
	 * @returns A `Result` of the parsed changeset or a {@link ChangesetParseError}.
	 */
	static parseSync(text: string): Result.Result<ParsedChangeset, ChangesetParseError> {
		return parseText(text);
	}

	/**
	 * Parse a changeset; the `Effect` form of {@link ChangesetFile.parseSync}.
	 *
	 * @param text - The file contents.
	 */
	static readonly parse = Effect.fn("ChangesetFile.parse")((text: string) =>
		Effect.fromResult(ChangesetFile.parseSync(text)),
	);
}
