// Regenerates src/internal/repositoryRestSettingKeys.ts:
//   pnpm --filter @effected/github exec tsx lib/scripts/generate-rest-setting-keys.ts
//
// The REST-accepted key set for `PATCH /repos/{owner}/{repo}` exists only as an
// erased TypeScript type, so it cannot be enumerated at runtime. This script
// reads it at build time from the declaration file `@octokit/openapi-types`
// publishes — the same package `@octokit/types` builds its route table from —
// and emits the top-level property names of
// `operations["repos/update"].requestBody.content["application/json"]`, plus
// REMOVED_BY_PINNED_VERSION: the keys a later api-version removed, each keyed
// to the version that removed it. `applySettings` subtracts one only when the
// client's api-version is at or past that version, so a client pinned to an
// older version still sends it.
//
// The header names the client's default api-version, so bumping
// DEFAULT_API_VERSION without regenerating (and re-checking this list against
// GitHub's breaking-change notes) fails the drift test.
//
// `@octokit/openapi-types` and `oxc-parser` are devDependencies used ONLY here
// and in the drift test; nothing under src/** imports either at runtime.
// __test__/repositoryRestSettingKeys.test.ts re-runs `render` in memory and
// fails when the committed file differs, so a bump of the octokit types that
// moves the key set fails CI until this script is re-run.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "oxc-parser";
import { DEFAULT_API_VERSION } from "../../src/internal/octokit.js";

const require = createRequire(import.meta.url);

/** Where the generated module lives, relative to this script. */
export const OUTPUT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../src/internal/repositoryRestSettingKeys.ts",
);

/** The declaration file the keys are read from. */
export const SOURCE: string = require.resolve("@octokit/openapi-types/types.d.ts");

/** The operation whose request body is enumerated. */
const OPERATION = "repos/update";

/**
 * Keys the description still declares that a later api-version removed from
 * the request, mapped to the version that removed them. Under that version or
 * any later one the REST PATCH ignores the key and answers 200.
 *
 * @remarks
 * `@octokit/openapi-types` describes GitHub's oldest supported api-version,
 * not the pinned one. Each entry is taken from GitHub's published
 * breaking-change list for its version and names its replacement.
 */
export const REMOVED_BY_PINNED_VERSION: Readonly<Record<string, string>> = {
	// Use `squash_merge_commit_title`.
	use_squash_pr_title_as_default: "2026-03-10",
};

// Minimal shape for the oxc ESTree/TS-ESTree nodes walked here.
interface Node {
	readonly type: string;
	readonly [key: string]: unknown;
}

const isNode = (value: unknown): value is Node =>
	typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";

/** A property signature's key as a string, whether written as an identifier or a string literal. */
const keyOf = (member: Node): string | undefined => {
	const key = member.key;
	if (!isNode(key)) return undefined;
	if (key.type === "Identifier" && typeof key.name === "string") return key.name;
	if (key.type === "Literal" && typeof key.value === "string") return key.value;
	return undefined;
};

/** The members of a type literal, or a failure naming where the walk lost the shape. */
const membersOf = (node: unknown, where: string): ReadonlyArray<Node> => {
	if (isNode(node) && node.type === "TSTypeLiteral" && Array.isArray(node.members)) {
		return node.members.filter(isNode);
	}
	throw new Error(
		`${OPERATION}: expected an inline type literal at ${where}, found ${isNode(node) ? node.type : "nothing"}`,
	);
};

/** The type literal under property `name` among `members`. */
const property = (members: ReadonlyArray<Node>, name: string, where: string): ReadonlyArray<Node> => {
	const member = members.find((m) => m.type === "TSPropertySignature" && keyOf(m) === name);
	if (member === undefined) throw new Error(`${OPERATION}: no property ${name} at ${where}`);
	const annotation = member.typeAnnotation;
	return membersOf(isNode(annotation) ? annotation.typeAnnotation : undefined, `${where}.${name}`);
};

/**
 * The top-level request-body keys of `PATCH /repos/{owner}/{repo}`, sorted.
 *
 * @param source - The text of `@octokit/openapi-types`' `types.d.ts`.
 */
export const extract = (source: string): ReadonlyArray<string> => {
	const result = parseSync("types.d.ts", source);
	if (result.errors.length > 0) throw new Error(result.errors.map((e) => e.message).join("; "));
	const program = result.program as unknown as { readonly body: ReadonlyArray<Node> };

	const operations = program.body
		.map((statement) => (statement.type === "ExportNamedDeclaration" ? statement.declaration : statement))
		.find(
			(declaration): declaration is Node =>
				isNode(declaration) &&
				declaration.type === "TSInterfaceDeclaration" &&
				isNode(declaration.id) &&
				declaration.id.name === "operations",
		);
	if (operations === undefined || !isNode(operations.body)) throw new Error("no `operations` interface");
	const operationMembers = (operations.body.body as ReadonlyArray<unknown>).filter(isNode);

	const operation = property(operationMembers, OPERATION, "operations");
	const body = property(operation, "requestBody", OPERATION);
	const content = property(body, "content", `${OPERATION}.requestBody`);
	const json = property(content, "application/json", `${OPERATION}.requestBody.content`);

	const keys = json.map(keyOf).filter((key): key is string => key !== undefined);
	if (keys.length === 0) throw new Error(`${OPERATION}: the request body declares no keys`);
	return [...new Set(keys)].sort();
};

/**
 * Fail when a removal entry names a key the description no longer declares:
 * the entry is then dead, and the list it guards has moved without review.
 */
export const checkRemovals = (keys: ReadonlyArray<string>): void => {
	const stale = Object.keys(REMOVED_BY_PINNED_VERSION).filter((key) => !keys.includes(key));
	if (stale.length > 0) {
		throw new Error(`REMOVED_BY_PINNED_VERSION names keys ${OPERATION} no longer declares: ${stale.join(", ")}`);
	}
};

/** An object key as Biome's formatter writes it: bare when it is an identifier. */
const propertyName = (key: string): string => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key));

/** The generated module's full text. */
export const render = (keys: ReadonlyArray<string>, version: string): string =>
	`// GENERATED FILE — do not edit by hand.
// Regenerate with: pnpm --filter @effected/github exec tsx lib/scripts/generate-rest-setting-keys.ts
//
// The top-level request-body keys of \`PATCH /repos/{owner}/{repo}\`, read at
// build time from @octokit/openapi-types@${version} (types.d.ts,
// operations["repos/update"].requestBody.content["application/json"]), and the
// keys a later api-version removed, by the version that removed them.
// Generated for the client's default api-version ${DEFAULT_API_VERSION}.
// __test__/repositoryRestSettingKeys.test.ts fails when this file drifts from it.

/**
 * Every key the REST repository PATCH accepts, as GitHub's OpenAPI description declares it.
 *
 * @internal
 */
export const REPOSITORY_REST_SETTING_KEYS: ReadonlySet<string> = new Set([
${keys.map((key) => `\t${JSON.stringify(key)},`).join("\n")}
]);

/**
 * Keys in {@link REPOSITORY_REST_SETTING_KEYS} that an api-version removed,
 * mapped to that version: a client at or past it does not send the key.
 *
 * @internal
 */
export const REMOVED_BY_PINNED_VERSION: Readonly<Record<string, string>> = {
${Object.entries(REMOVED_BY_PINNED_VERSION)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([key, removedIn]) => `\t${propertyName(key)}: ${JSON.stringify(removedIn)},`)
	.join("\n")}
};
`;

/** The generated text for the installed `@octokit/openapi-types`. */
export const generate = (): string => {
	const version = (require("@octokit/openapi-types/package.json") as { readonly version: string }).version;
	const keys = extract(readFileSync(SOURCE, "utf8"));
	checkRemovals(keys);
	return render(keys, version);
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	writeFileSync(OUTPUT, generate());
	console.log(`wrote ${OUTPUT}`);
}
