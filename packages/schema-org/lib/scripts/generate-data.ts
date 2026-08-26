// Run by hand only:
//   pnpm --filter @effected/schema-org exec tsx lib/scripts/generate-data.ts
//
// Lives under lib/ because that is where this repo keeps package-local tooling
// that is not shipped source; packages/runtimes/lib/scripts/generate-defaults.ts
// is the precedent.
//
// Regenerates the vendored schema.org vocabulary literals in
// src/internal/vocabulary.ts from the vendored release document at
// lib/data/schemaorg-current-https.jsonld — the published release document,
// committed rather than vendored as a submodule: the upstream repo is 254 MB and
// this is the single release file we read from it. Locates each target
// literal by its exported const identifier via oxc-parser and splices only
// that initializer's byte span, leaving the module header, types and the
// hand-authored derived lookups untouched; the header's regeneration-notes
// block is spliced by its marker comments the same way. Idempotent: re-run and
// diff when schema.org releases.
//
// Never run in CI or the test suite — only lib/scripts/** may import oxc-parser,
// and nothing under src/** reads a file at runtime. Reads the `-current`
// document, not `-all`: retired terms are not something this package accepts.
//
// THE UPSTREAM DOCUMENT IS DATA, NOT TRUTH. At v30.0 it is internally
// inconsistent in a way that produces a plausible-looking table: three
// properties name a `domainIncludes` class the current document never
// declares. Regeneration is the only place that can catch that class of
// defect, so this is the place that asserts. Every assertion below aborts the
// run rather than emitting a damaged table, and the one known exception is
// enumerated by name and recorded in the generated header.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Graph, Option } from "effect";
import { parseSync } from "oxc-parser";

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** The vendored release. Re-pointing this is part of a submodule re-pin, never a lone edit. */
const RELEASE = "30.0";
const SOURCE = resolve(scriptDir, "../data/schemaorg-current-https.jsonld");
const TARGET = resolve(scriptDir, "../../src/internal/vocabulary.ts");

/**
 * The one enumerated inconsistency in v30.0: these properties name
 * `DeliveryTimeSettings` as a domain, and that class is declared only in the
 * `-all` document. They are dropped from the affected domain WITH A NOTE, and
 * anything else that fails to resolve aborts the run.
 */
const KNOWN_UNRESOLVED_DOMAINS: readonly (readonly [property: string, target: string])[] = [
	["deliveryTime", "DeliveryTimeSettings"],
	["isUnlabelledFallback", "DeliveryTimeSettings"],
	["shippingDestination", "DeliveryTimeSettings"],
];

// ── Source reading ──────────────────────────────────────────────────────

/** Minimal shape of the oxc ESTree nodes we traverse; oxc carries byte offsets. */
interface Node {
	readonly type: string;
	readonly start: number;
	readonly end: number;
	readonly [key: string]: unknown;
}

interface JsonLdNode {
	readonly "@id"?: unknown;
	readonly "@type"?: unknown;
	readonly "rdfs:subClassOf"?: unknown;
	readonly "schema:domainIncludes"?: unknown;
	readonly "schema:supersededBy"?: unknown;
}

interface SourceDocument {
	readonly "@context": Readonly<Record<string, unknown>>;
	readonly "@graph": readonly JsonLdNode[];
}

/** `domainIncludes`, `@type` and `subClassOf` are each "one object or an array of them". */
function many(value: unknown): readonly unknown[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

function idOf(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "object" && value !== null) {
		const id = (value as { readonly "@id"?: unknown })["@id"];
		if (typeof id === "string") return id;
	}
	return undefined;
}

/** Strip the `schema:` prefix; leave a foreign prefixed id alone so the caller can see it is foreign. */
function shortName(id: string): string {
	return id.startsWith("schema:") ? id.slice(7) : id;
}

function isNative(id: string): boolean {
	return id.startsWith("schema:");
}

/** Sort by code point, not locale, so regeneration is stable across environments. */
function sorted(names: Iterable<string>): string[] {
	return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ── Ingest ──────────────────────────────────────────────────────────────

interface ClassEntry {
	readonly parents: readonly string[];
	readonly foreignParents: readonly string[];
	readonly supersededBy: string | undefined;
}

interface PropertyEntry {
	readonly domains: readonly string[];
	readonly supersededBy: string | undefined;
}

const document = JSON.parse(readFileSync(SOURCE, "utf8")) as SourceDocument;

/**
 * Recognized foreign prefixes come from the document's own `@context`, minus
 * `schema` itself. Deriving them rather than hard-coding a list means a new
 * alignment vocabulary is only "recognized" once schema.org has declared it —
 * an undeclared prefix is a decision for a human, not a branch to guess at.
 */
const foreignPrefixes = new Set(Object.keys(document["@context"]).filter((prefix) => prefix !== "schema"));

function prefixOf(id: string): string | undefined {
	const colon = id.indexOf(":");
	return colon === -1 ? undefined : id.slice(0, colon);
}

const classes = new Map<string, ClassEntry>();
const properties = new Map<string, PropertyEntry>();

for (const node of document["@graph"]) {
	const id = idOf(node["@id"]);
	if (id === undefined || !isNative(id)) continue; // trap 5: filter by id prefix, never by @type
	const kinds = many(node["@type"]).map(idOf);
	const supersededBy = idOf(node["schema:supersededBy"]);

	if (kinds.includes("rdfs:Class")) {
		const parents: string[] = [];
		const foreignParents: string[] = [];
		for (const parent of many(node["rdfs:subClassOf"])) {
			const parentId = idOf(parent);
			if (parentId === undefined) continue;
			if (isNative(parentId)) parents.push(shortName(parentId));
			else foreignParents.push(parentId);
		}
		classes.set(shortName(id), { parents, foreignParents, supersededBy });
		continue;
	}

	if (kinds.includes("rdf:Property")) {
		const domains: string[] = [];
		for (const domain of many(node["schema:domainIncludes"])) {
			const domainId = idOf(domain);
			if (domainId !== undefined) domains.push(shortName(domainId));
		}
		properties.set(shortName(id), { domains, supersededBy });
	}
}

// ── Assertions ──────────────────────────────────────────────────────────

const notes: string[] = [];
const knownUnresolved = new Set(KNOWN_UNRESOLVED_DOMAINS.map(([property, target]) => `${property}\u0000${target}`));

/** Assertion 1: every `domainIncludes` target resolves to a declared native class. */
const droppedDomains: string[] = [];
const unresolvedDomains: string[] = [];
const resolvedDomains = new Map<string, readonly string[]>();
for (const [property, entry] of properties) {
	const kept: string[] = [];
	for (const domain of entry.domains) {
		if (classes.has(domain)) {
			kept.push(domain);
			continue;
		}
		if (knownUnresolved.has(`${property}\u0000${domain}`)) {
			droppedDomains.push(`${property} -> ${domain}`);
			continue;
		}
		unresolvedDomains.push(`${property} -> ${domain}`);
	}
	resolvedDomains.set(property, kept);
}
if (unresolvedDomains.length > 0) {
	throw new Error(
		`${SOURCE}: ${unresolvedDomains.length} domainIncludes target(s) name a class this document does not declare: ` +
			`${unresolvedDomains.join("; ")}. The upstream document is inconsistent — decide per term whether the class ` +
			"belongs in the table or the domain should be dropped, then add it to KNOWN_UNRESOLVED_DOMAINS with a note.",
	);
}

/** Assertion 2: every parent resolves to a native class or carries a prefix the document itself declares. */
const unrecognizedParents: string[] = [];
const foreignParentClasses: string[] = [];
for (const [name, entry] of classes) {
	for (const parent of entry.parents) {
		if (!classes.has(parent)) unrecognizedParents.push(`${name} -> ${parent}`);
	}
	for (const parent of entry.foreignParents) {
		const prefix = prefixOf(parent);
		if (prefix === undefined || !foreignPrefixes.has(prefix)) unrecognizedParents.push(`${name} -> ${parent}`);
	}
	if (entry.foreignParents.length > 0) foreignParentClasses.push(name);
}
if (unrecognizedParents.length > 0) {
	throw new Error(
		`${SOURCE}: ${unrecognizedParents.length} subClassOf target(s) neither resolve to a declared class nor carry a ` +
			`prefix declared in the document's @context: ${unrecognizedParents.join("; ")}. A new alignment vocabulary ` +
			"is a decision for a human, not a branch for the ancestor walk to guess at.",
	);
}

/** Every `supersededBy` target must itself be a declared term of the same kind. */
function resolveSuperseded(
	entries: ReadonlyMap<string, { readonly supersededBy: string | undefined }>,
	declared: ReadonlySet<string>,
	kind: string,
): ReadonlyMap<string, string> {
	const out = new Map<string, string>();
	const bad: string[] = [];
	for (const [name, entry] of entries) {
		if (entry.supersededBy === undefined) continue;
		if (!isNative(entry.supersededBy)) {
			bad.push(`${name} -> ${entry.supersededBy}`);
			continue;
		}
		const target = shortName(entry.supersededBy);
		if (!declared.has(target)) {
			bad.push(`${name} -> ${target}`);
			continue;
		}
		out.set(name, target);
	}
	if (bad.length > 0) {
		throw new Error(
			`${SOURCE}: ${bad.length} ${kind} supersededBy target(s) are not declared ${kind} terms: ${bad.join("; ")}.`,
		);
	}
	return out;
}

const typeNames = sorted(classes.keys());
const propertyNames = sorted(properties.keys());
const typeIndex = new Map(typeNames.map((name, index) => [name, index]));
const propertyIndex = new Map(propertyNames.map((name, index) => [name, index]));

const supersededTypes = resolveSuperseded(classes, new Set(typeNames), "class");
const supersededProperties = resolveSuperseded(properties, new Set(propertyNames), "property");

/** Assertion 3: every index this generator is about to emit is in range for its table. */
function checkIndex(index: number | undefined, limit: number, what: string): number {
	if (index === undefined || !Number.isInteger(index) || index < 0 || index >= limit) {
		throw new Error(`${SOURCE}: interned index out of range for ${what}: ${String(index)} (table size ${limit}).`);
	}
	return index;
}

/**
 * Assertion 4: the `rdfs:subClassOf` relation is acyclic.
 *
 * `Vocabulary.ancestorsOf` walks this relation as a DAG. Nothing in schema.org
 * *enforces* acyclicity — it is a convention of the vocabulary, not a checked
 * property of the document — so a cycle introduced upstream would send the
 * runtime walk into a loop, or silently truncate a closure once a visited set
 * absorbed it. Neither failure names its cause.
 *
 * `effect/Graph` owns the graph algorithms, so this uses `isAcyclic` rather
 * than a hand-rolled colour-marking DFS, and names the offending cycle through
 * `stronglyConnectedComponents` when it fires: a component with more than one
 * member IS the cycle, which is the only report a maintainer can act on. This
 * runs at generation time only — the shipped table carries no graph structure
 * and the runtime walk is unchanged.
 */
function assertAcyclic(): void {
	const graph = Graph.directed<string, null>((mutable) => {
		const nodes = new Map<string, Graph.NodeIndex>();
		for (const name of typeNames) nodes.set(name, Graph.addNode(mutable, name));
		for (const name of typeNames) {
			const from = nodes.get(name);
			if (from === undefined) continue;
			for (const parent of classes.get(name)?.parents ?? []) {
				const to = nodes.get(parent);
				if (to !== undefined) Graph.addEdge(mutable, from, to, null);
			}
		}
	});

	if (Graph.isAcyclic(graph)) return;

	const cycles = Graph.stronglyConnectedComponents(graph)
		.filter((component) => component.length > 1)
		.map((component) =>
			component.map((index) => Option.getOrElse(Graph.getNode(graph, index), () => String(index))).join(" -> "),
		);
	throw new Error(
		`${SOURCE}: rdfs:subClassOf is cyclic, which the ancestor walk assumes it is not. ` +
			`Cycle(s): ${cycles.join("; ")}.`,
	);
}

assertAcyclic();

// ── Encode ──────────────────────────────────────────────────────────────

const subClassOfRows = typeNames.map((name) =>
	(classes.get(name)?.parents ?? [])
		.map((parent) => checkIndex(typeIndex.get(parent), typeNames.length, `parent ${parent} of ${name}`))
		.sort((a, b) => a - b)
		.join(","),
);

/**
 * The transpose of `domainIncludes`: type → the properties that name it
 * directly. The validator asks "is p legal on T" by walking T's ancestor
 * closure and unioning these rows, so this orientation answers both that
 * question and `Vocabulary.propertiesOf` without a second table.
 */
const domainPropertyRows = typeNames.map(() => [] as number[]);
for (const property of propertyNames) {
	const pIndex = checkIndex(propertyIndex.get(property), propertyNames.length, `property ${property}`);
	for (const domain of resolvedDomains.get(property) ?? []) {
		const tIndex = checkIndex(typeIndex.get(domain), typeNames.length, `domain ${domain} of ${property}`);
		domainPropertyRows[tIndex]?.push(pIndex);
	}
}

function pairRows(pairs: ReadonlyMap<string, string>, index: ReadonlyMap<string, number>, limit: number): string[] {
	return sorted(pairs.keys()).map((name) => {
		const from = checkIndex(index.get(name), limit, `superseded term ${name}`);
		const to = checkIndex(index.get(pairs.get(name) ?? ""), limit, `superseding term of ${name}`);
		return `${from},${to}`;
	});
}

const emptyDomainProperties = propertyNames.filter((name) => (resolvedDomains.get(name) ?? []).length === 0);
notes.push(
	`${typeNames.length} classes, ${propertyNames.length} properties (schema-native only; foreign alignment terms filtered by @id prefix).`,
);
notes.push(
	`${foreignParentClasses.length} classes carry a parent outside the schema namespace, dropped from SUB_CLASS_OF because the walk cannot follow it: ${foreignParentClasses.join(", ")}.`,
);
notes.push(
	droppedDomains.length === 0
		? "No domainIncludes target failed to resolve."
		: `${droppedDomains.length} domainIncludes target(s) name a class this release does not declare and were dropped: ${droppedDomains.join(", ")}. That class exists only in the -all document; the properties keep their remaining domains.`,
);
notes.push(
	`${emptyDomainProperties.length === 1 ? "1 property is" : `${emptyDomainProperties.length} properties are`} legal nowhere, because the document gives no resolvable domain: ${emptyDomainProperties.join(", ")}. That is the document's answer, not a generator bug.`,
);

// ── Splice ──────────────────────────────────────────────────────────────

/** Render an array literal: one quoted row per line, framed by its marker comments. */
function renderRows(marker: string, rows: readonly string[]): string {
	return [
		"[",
		`\t// schemaorg:${marker}:start`,
		...rows.map((row) => `\t${JSON.stringify(row)},`),
		`\t// schemaorg:${marker}:end`,
		"]",
	].join("\n");
}

/** Depth-first search for the initializer of `export const <exportName> = <init>`. */
function findInitializer(program: Node, exportName: string): Node | undefined {
	let found: Node | undefined;
	const visit = (node: unknown): void => {
		if (found !== undefined || node === null || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}
		const current = node as Node;
		if (current.type === "VariableDeclarator") {
			const id = current.id as Node | undefined;
			if (id?.type === "Identifier" && id.name === exportName) {
				const init = current.init as Node | undefined;
				if (init !== undefined) {
					found = init.type === "TSAsExpression" ? (init.expression as Node) : init;
					return;
				}
			}
		}
		for (const value of Object.values(current)) {
			if (value !== null && typeof value === "object") visit(value);
		}
	};
	visit(program);
	return found;
}

interface Edit {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

/** Locate the body between two marker comment lines, so the header note is spliced the same way the literals are. */
function markerSpan(source: string, marker: string): Edit {
	const start = source.indexOf(`// schemaorg:${marker}:start`);
	const end = source.indexOf(`// schemaorg:${marker}:end`);
	if (start === -1 || end === -1 || end < start) {
		throw new Error(`${TARGET}: could not find the "${marker}" marker pair.`);
	}
	return { start: start + `// schemaorg:${marker}:start`.length, end, text: "" };
}

const source = readFileSync(TARGET, "utf8");
const parsed = parseSync(TARGET, source);
if (parsed.errors.length > 0) {
	throw new Error(`${TARGET}: ${parsed.errors.map((error) => error.message).join("; ")}`);
}
const program = parsed.program as unknown as Node;

const edits: Edit[] = [];

for (const [exportName, marker, rows] of [
	["TYPE_NAMES", "types", typeNames],
	["PROPERTY_NAMES", "properties", propertyNames],
	["SUB_CLASS_OF", "subClassOf", subClassOfRows],
	["DOMAIN_PROPERTIES", "domainProperties", domainPropertyRows.map((row) => row.join(","))],
	["SUPERSEDED_TYPES", "supersededTypes", pairRows(supersededTypes, typeIndex, typeNames.length)],
	[
		"SUPERSEDED_PROPERTIES",
		"supersededProperties",
		pairRows(supersededProperties, propertyIndex, propertyNames.length),
	],
	["FOREIGN_PREFIXES", "foreignPrefixes", sorted(foreignPrefixes)],
] as const) {
	const node = findInitializer(program, exportName);
	if (node === undefined) throw new Error(`${TARGET}: could not find exported literal "${exportName}".`);
	edits.push({ start: node.start, end: node.end, text: renderRows(marker, rows) });
}

const versionNode = findInitializer(program, "VOCABULARY_VERSION");
if (versionNode === undefined) throw new Error(`${TARGET}: could not find exported literal "VOCABULARY_VERSION".`);
edits.push({ start: versionNode.start, end: versionNode.end, text: JSON.stringify(RELEASE) });

const noteSpan = markerSpan(source, "notes");
edits.push({
	...noteSpan,
	text: `\n${notes.map((note) => `// - ${note}`).join("\n")}\n`,
});

// Splice from the end of the file backward so an earlier edit's length change
// never invalidates the byte offsets captured for a later one.
edits.sort((a, b) => b.start - a.start);
let next = source;
for (const edit of edits) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);

if (next === source) {
	console.log(`unchanged ${TARGET}`);
} else {
	writeFileSync(TARGET, next);
	console.log(`updated ${TARGET}`);
}
for (const note of notes) console.log(`  note: ${note}`);
