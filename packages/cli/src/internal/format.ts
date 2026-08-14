import { SchemaIssue } from "effect";

/**
 * Core's structured formatter, with one phrasing override.
 *
 * @remarks
 * Built once: it is a pure function of the issue tree and carries no state.
 *
 * Core renders an excess property as `"Expected no excess property"`, which
 * describes the **schema's rule** rather than the **user's mistake**. The path
 * already names the key, so `unknown key at groups.g.cleanup.rulesetz` says the
 * same thing in the words someone editing a config file would use. Every other
 * leaf keeps core's phrasing, which is why this goes through `defaultLeafHook`
 * rather than a table of our own.
 *
 * @internal
 */
const formatter = SchemaIssue.makeFormatterStandardSchemaV1({
	leafHook: (issue) => (issue._tag === "UnexpectedKey" ? "unknown key" : SchemaIssue.defaultLeafHook(issue)),
});

/**
 * Flatten an issue tree to one line per rejected value.
 *
 * @remarks
 * Shared by `SchemaIssueRenderer` and `ConfigIssueRenderer` and imported by
 * nothing else. It lives here rather than in either module so that
 * `ConfigIssueRenderer` — the only export that references the optional
 * `@effected/config-file` peer — can stay a module no other module imports.
 *
 * **No walker of our own.** `makeFormatterStandardSchemaV1` already flattens the
 * tree to `{ message, path }` entries, and `defaultLeafHook` covers every leaf
 * variant, so a wrong *type* renders as sensibly as an unknown key and a
 * variant added upstream is covered without a change here.
 *
 * Nodes are never stringified: each carries the entire AST inline, annotations
 * included, so `String(node)` would dump the schema rather than describe the
 * failure. Only `message` and `path` are read.
 *
 * @internal
 */
export const formatIssue = (issue: unknown): ReadonlyArray<string> => {
	// Anything that is not an issue tree yields no lines rather than throwing. A
	// rendering helper on an error path must never become the reason a program
	// dies — it is called when something has already gone wrong.
	if (!SchemaIssue.isIssue(issue)) return [];

	const lines = formatter(issue).issues.map((entry) => {
		const path = (entry.path ?? []).map(String).join(".");
		return path === "" ? entry.message : `${entry.message} at ${path}`;
	});

	// A union reports every branch it tried, so one wrong key in a three-member
	// union prints the same "unknown key" line three times. The per-branch
	// "Missing key" lines differ and are worth keeping — they say which shapes
	// were allowed — but the repeat is pure noise in front of them.
	return [...new Set(lines)];
};
