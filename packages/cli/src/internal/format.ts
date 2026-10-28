import { SchemaAST, SchemaIssue } from "effect";
import { Fmt } from "../Fmt.js";

/** The message an unknown key renders as: the leaf hook below writes it and the "did you mean" hint reads it. */
const UNKNOWN_KEY = "unknown key";

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
	leafHook: (issue) => (issue._tag === "UnexpectedKey" ? UNKNOWN_KEY : SchemaIssue.defaultLeafHook(issue)),
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
export const formatIssue = (issue: unknown): ReadonlyArray<string> =>
	issueEntries(issue).map((entry) =>
		entry.path.length === 0 ? entry.message : `${entry.message} at ${entry.path.join(".")}`,
	);

/**
 * {@link formatIssue}, with a "did you mean" hint on an unknown key the schema has a near match for.
 *
 * @remarks
 * Used by `ConfigIssueRenderer` only. The declared keys come from the issue tree itself: core's `UnexpectedKey` leaf
 * carries the AST of the struct being decoded, whose property signatures are the keys the schema accepts at that
 * path, so no schema is passed in and no `@effected/config-file` value is needed. The hint is `Fmt.suggest`'s list,
 * each key sanitised, and a line with no near match is exactly the line {@link formatIssue} draws.
 *
 * @internal
 */
export const formatIssueWithHints = (issue: unknown): ReadonlyArray<string> => {
	const declared = declaredKeys(issue);
	return issueEntries(issue).map((entry) => {
		if (entry.path.length === 0) return entry.message;
		const line = `${entry.message} at ${entry.path.join(".")}`;
		if (entry.message !== UNKNOWN_KEY) return line;
		const candidates = declared.get(pathKey(entry.path));
		const input = entry.path[entry.path.length - 1];
		if (candidates === undefined || input === undefined) return line;
		const near = Fmt.suggest(input, candidates);
		if (near.length === 0) return line;
		return `${line} (did you mean ${orList(near.map((key) => `"${Fmt.sanitize(key)}"`))}?)`;
	});
};

/** A path as a map key: `JSON.stringify` keeps `["a.b"]` and `["a", "b"]` apart, which joining on `.` would not. */
const pathKey = (path: ReadonlyArray<string>): string => JSON.stringify(path);

/** `"a"`, `"a" or "b"`, `"a", "b" or "c"`. */
const orList = (items: ReadonlyArray<string>): string =>
	items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;

/**
 * The keys each unknown key's struct declares, by the unknown key's own path.
 *
 * @remarks
 * Walks the tree the way core's formatter does (a `Pointer` extends the path; a `Filter`, `Encoding`, `Composite` or
 * `AnyOf` passes it through), so a path here is the path the formatter gives the same leaf. A union reports one
 * `UnexpectedKey` per branch at one path, and every branch's keys are candidates. Only string keys are offered: a
 * symbol key is never something a person typed into a config file.
 */
const declaredKeys = (issue: unknown): ReadonlyMap<string, ReadonlySet<string>> => {
	const found = new Map<string, Set<string>>();
	if (!SchemaIssue.isIssue(issue)) return found;
	const walk = (node: SchemaIssue.Issue, path: ReadonlyArray<string>): void => {
		switch (node._tag) {
			case "Filter":
			case "Encoding":
				walk(node.issue, path);
				return;
			case "Pointer":
				walk(node.issue, [...path, ...node.path.map(String)]);
				return;
			case "Composite":
			case "AnyOf":
				for (const child of node.issues) walk(child, path);
				return;
			case "UnexpectedKey": {
				if (!SchemaAST.isObjects(node.ast)) return;
				const key = pathKey(path);
				const keys = found.get(key) ?? new Set<string>();
				for (const signature of node.ast.propertySignatures) {
					if (typeof signature.name === "string") keys.add(signature.name);
				}
				found.set(key, keys);
				return;
			}
			default:
				return;
		}
	};
	walk(issue, []);
	return found;
};

/**
 * One rejected value: what is wrong and where.
 *
 * @internal
 */
export interface IssueEntry {
	readonly message: string;
	readonly path: ReadonlyArray<string>;
}

/**
 * The rejected values of an issue tree, once each: what both the lines and the tree are built from.
 *
 * @remarks
 * Anything that is not an issue tree yields none rather than throwing. A rendering helper on an error path must never
 * become the reason a program dies: it is called when something has already gone wrong. A union reports every branch
 * it tried, so one wrong key in a three-member union is the same entry three times; the per-branch "Missing key"
 * entries differ and are kept, since they say which shapes were allowed, but the repeat is pure noise in front of them.
 *
 * @internal
 */
export const issueEntries = (issue: unknown): ReadonlyArray<IssueEntry> => {
	if (!SchemaIssue.isIssue(issue)) return [];
	const seen = new Set<string>();
	const entries: Array<IssueEntry> = [];
	for (const entry of formatter(issue).issues) {
		const path = (entry.path ?? []).map(String);
		const key = path.length === 0 ? entry.message : `${entry.message} at ${path.join(".")}`;
		if (seen.has(key)) continue;
		seen.add(key);
		entries.push({ message: entry.message, path });
	}
	return entries;
};

/** A node of the path trie an issue tree is drawn from. */
interface PathNode {
	readonly messages: Array<string>;
	readonly children: Map<string, PathNode>;
}

const emptyNode = (): PathNode => ({ messages: [], children: new Map() });

/**
 * The entries as the input of a `Doc.tree`: one node per path segment, so `groups.g.extra` is three nested nodes, and
 * the message at the end of a path is the node's label (`extra: unknown key`) or, when the node has more to say, its
 * leaves.
 *
 * @internal
 */
export const issueTreeChildren = (entries: ReadonlyArray<IssueEntry>): ReadonlyArray<IssueTreeNode> => {
	const root = emptyNode();
	for (const entry of entries) {
		let node = root;
		for (const segment of entry.path) {
			let next = node.children.get(segment);
			if (next === undefined) {
				next = emptyNode();
				node.children.set(segment, next);
			}
			node = next;
		}
		node.messages.push(entry.message);
	}
	const leaves = (node: PathNode): ReadonlyArray<IssueTreeNode> => node.messages.map((message) => ({ label: message }));
	const named = (segment: string, node: PathNode): IssueTreeNode => {
		if (node.children.size === 0 && node.messages.length === 1) return { label: `${segment}: ${node.messages[0]}` };
		return {
			label: segment,
			children: [...leaves(node), ...[...node.children].map(([name, child]) => named(name, child))],
		};
	};
	return [...leaves(root), ...[...root.children].map(([name, child]) => named(name, child))];
};

/**
 * The shape `issueTreeChildren` returns: a `TreeInput` without the dependency on `Doc`, which this module must not
 * import at runtime.
 *
 * @internal
 */
export interface IssueTreeNode {
	readonly label: string;
	readonly children?: ReadonlyArray<IssueTreeNode>;
}
