// Extracts the pnpm 12 settings inventory from the vendored pnpm source at
// .repos/pnpm (pinned to v12.20.0) into
// __test__/fixtures/pnpm-12.20.0-settings.json. Never shipped: it exists so the
// fixture the coverage test reads can be re-derived after a re-pin. Run from the
// package directory: `node scripts/extract-pnpm-settings.mts` (`--check` exits 1
// when the committed fixture differs from a fresh extraction).
//
// The method, and why each source answers what it answers, is in
// __test__/fixtures/pnpm-12.20.0-settings.README.md.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PNPM = resolve(PACKAGE, "../../.repos/pnpm/pnpm");
const CONFIG = join(PNPM, "crates/config/src");
const DOCS = join(PNPM, "docs/settings");
const FIXTURE = join(PACKAGE, "__test__/fixtures/pnpm-12.20.0-settings.json");

const read = (path: string): string => readFileSync(path, "utf8");

const camel = (snake: string): string => snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const kebabToCamel = (kebab: string): string => kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** The body of `pub struct <name> { ... }`, its closing brace at column 0. */
const structBody = (text: string, name: string): string => {
	const start = text.indexOf(`pub struct ${name} {`);
	if (start === -1) throw new Error(`struct ${name} not found`);
	const end = text.indexOf("\n}\n", start);
	return text.slice(start, end);
};

interface Field {
	readonly name: string;
	readonly rustType: string;
	readonly triState: boolean;
}

/** The serde-visible fields of a struct: `pub <snake>: <type>,`, honouring `rename` and `skip`. */
const fieldsOf = (body: string): ReadonlyArray<Field> => {
	const fields: Array<Field> = [];
	let rename: string | undefined;
	let skip = false;
	let triState = false;
	for (const line of body.split("\n")) {
		const attribute = line.match(/^\s*#\[serde\((.*)\)\]/);
		if (attribute !== null) {
			const args = attribute[1] ?? "";
			const renamed = args.match(/rename = "([^"]+)"/);
			if (renamed !== null) rename = renamed[1];
			if (/\bskip\b/.test(args)) skip = true;
			if (args.includes("deserialize_double_option")) triState = true;
			continue;
		}
		const field = line.match(/^\s*pub (\w+): (.+),\s*$/);
		if (field !== null) {
			if (!skip) fields.push({ name: rename ?? camel(field[1] ?? ""), rustType: field[2] ?? "", triState });
			rename = undefined;
			skip = false;
			triState = false;
		}
	}
	return fields;
};

/** `self.<field> = None;` lines of the named functions: the fields the global config.yaml clears. */
const clearedFields = (text: string, functions: ReadonlyArray<string>): Set<string> => {
	const cleared = new Set<string>();
	for (const fn of functions) {
		const start = text.indexOf(`fn ${fn}(`);
		if (start === -1) throw new Error(`fn ${fn} not found`);
		const end = text.indexOf("\n    }\n", start);
		for (const match of text.slice(start, end).matchAll(/self\.(\w+) = None;/g)) cleared.add(camel(match[1] ?? ""));
	}
	return cleared;
};

/** A `const NAME: &[&str] = &[ ... ];` string list. */
const stringList = (text: string, name: string): ReadonlyArray<string> => {
	const start = text.indexOf(`const ${name}:`);
	if (start === -1) throw new Error(`const ${name} not found`);
	const end = text.indexOf("];", start);
	return [...text.slice(start, end).matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
};

// --- the settings structs -------------------------------------------------

const settingsRs = read(join(CONFIG, "workspace_yaml/settings.rs"));
const machineRs = read(join(CONFIG, "workspace_yaml/machine.rs"));
const workspaceFields = fieldsOf(structBody(settingsRs, "WorkspaceSettings"));
const machineFields = fieldsOf(structBody(machineRs, "MachineSettings"));

// --- where each is read ---------------------------------------------------

const scopeRs = read(join(CONFIG, "workspace_yaml/workspace_scope.rs"));
const globalCleared = clearedFields(scopeRs, [
	"clear_workspace_project_fields",
	"clear_workspace_layout_fields",
	"clear_workspace_resolution_fields",
	"clear_workspace_hooks_fields",
]);

const refusedRs = read(join(CONFIG, "refused_keys.rs"));
const projectRefused = new Set(stringList(refusedRs, "PROJECT_MANIFEST_SKIPPED_KEYS"));

const envSources = [read(join(CONFIG, "env_overlay.rs")), read(join(CONFIG, "env_overlay/resolution.rs"))].join("\n");
/**
 * How pnpm 12 parses each setting's `PNPM_CONFIG_*` value, keyed by setting:
 * `json` (`json_field!`, `tri_array_field!`: a JSON document, ignored when it
 * does not parse), `text` (`string_field!`, `tri_string_field!` and the direct
 * string assignments: the value as written), `jsonOrText` (`enum_field!`: JSON,
 * else the value as a JSON string), `flag` (`verifyDepsBeforeRun`: presence
 * sets it, an unrecognized value reads as `true`), `subkeys` (a section read
 * from one variable per key, `NODE_PACKAGE_MAP_MODE`, `MACOS_BACKUP_*`).
 */
type EnvFormat = "json" | "text" | "jsonOrText" | "flag" | "subkeys";
const MACRO_FORMATS: Readonly<Record<string, EnvFormat>> = {
	json_field: "json",
	tri_array_field: "json",
	string_field: "text",
	string_field_allow_empty: "text",
	tri_string_field: "text",
	enum_field: "jsonOrText",
};
const envFormats = new Map<string, EnvFormat>();
const setFormat = (field: string, format: EnvFormat): void => {
	const name = camel(field);
	const known = envFormats.get(name);
	if (known !== undefined && known !== format) throw new Error(`${name}: env format ${known} and ${format}`);
	envFormats.set(name, format);
};
for (const match of envSources.matchAll(/(\w+)!\(\s*settings,\s*reader,\s*(\w+),\s*"\w+"/g)) {
	const format = MACRO_FORMATS[match[1] ?? ""];
	if (format === undefined) throw new Error(`unknown env macro ${match[1]}`);
	setFormat(match[2] ?? "", format);
}
// The fields read outside the macros, by direct assignment from a `reader.value*` call.
for (const match of envSources.matchAll(/settings\.(\w+)\s*=\s*([^;]+);/g)) {
	const [, field = "", expression = ""] = match;
	if (!/reader\.value|serde_json::Value::String|Some\(save_prefix\)|if s\.is_empty/.test(expression)) continue;
	setFormat(field, expression.includes("VerifyDepsBeforeRun") ? "flag" : "text");
}
for (const match of envSources.matchAll(/(?:settings|self)\.(\w+)\.get_or_insert_default\(\)/g))
	setFormat(match[1] ?? "", "subkeys");

const iniRs = read(join(CONFIG, "npmrc_auth/ini.rs"));
const networkKeys = iniRs.slice(iniRs.indexOf("fn apply_network_key"), iniRs.indexOf("fn apply_ssl_key"));
const npmrcFields = new Set<string>(["registry"]);
for (const match of networkKeys.matchAll(/"([a-z-]+)"(?: \| "([a-z-]+)")? =>/g)) {
	for (const kebab of [match[1], match[2]]) if (kebab !== undefined) npmrcFields.add(kebabToCamel(kebab));
}

const knownRs = read(join(CONFIG, "known_settings.rs"));
const inert = [...stringList(knownRs, "UNTYPED_WORKSPACE_SETTING_KEYS")].sort();
const otherVersions = [...knownRs.matchAll(/\("(\w+)", "(pnpm v\d+)"\)/g)].map((match) => ({
	name: match[1] ?? "",
	version: match[2] ?? "",
}));

// --- the docs -------------------------------------------------------------

interface DocEntry {
	readonly page: string;
	readonly anchor: string;
	readonly heading: string;
	readonly default?: string;
	readonly type?: string;
}

const slug = (heading: string): string => {
	const explicit = heading.match(/\{#([^}]+)\}\s*$/);
	if (explicit !== null) return explicit[1] ?? "";
	return heading
		.replace(/`/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9 _-]/g, "")
		.trim()
		.replace(/\s+/g, "-");
};

const docs = new Map<string, DocEntry>();
const docPages = readdirSync(DOCS).filter((file) => /\.mdx?$/.test(file));
for (const file of docPages.sort()) {
	const text = read(join(DOCS, file));
	const id = text.match(/^id:\s*(\S+)/m)?.[1];
	// A partial (`_catalogMode.mdx`) renders inside the page that imports it.
	const page =
		id ??
		docPages
			.map((f) => [f, read(join(DOCS, f))] as const)
			.find(([, t]) => t.includes(`./${file}'`))?.[1]
			.match(/^id:\s*(\S+)/m)?.[1];
	// Docusaurus suffixes a repeated heading id on one page: `-1`, `-2`, ...
	const seen = new Map<string, number>();
	const uniqueSlug = (heading: string): string => {
		const base = slug(heading);
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		return count === 0 ? base : `${base}-${count}`;
	};
	const sections = text.split(/^### /m).slice(1);
	for (const whole of sections) {
		const heading = (whole.split("\n")[0] ?? "").trim();
		const anchor = uniqueSlug(heading);
		// The heading's own bullets, not those of its `####` sub-sections.
		const section = whole.split(/^#### /m)[0] ?? whole;
		// CLI flags (`--cpu=<name>`) are command options, not settings.
		if (heading.startsWith("--")) continue;
		const name = heading
			.replace(/^\[no-\]/, "")
			.replace(/\{#[^}]+\}$/, "")
			.trim();
		const top = name.split(".")[0] ?? name;
		const defaultText = section.match(/^\* Default: (.+)$/m)?.[1]?.trim();
		const typeText = section.match(/^\* Type: (.+)$/m)?.[1]?.trim();
		if (name !== top) {
			// A dotted sub-key (`lockfile.format`) documents a part of its parent.
			if (!docs.has(top)) docs.set(top, { page: page ?? "", anchor, heading });
			continue;
		}
		docs.set(top, {
			page: page ?? "",
			anchor,
			heading,
			...(defaultText === undefined ? {} : { default: defaultText }),
			...(typeText === undefined ? {} : { type: typeText }),
		});
	}
}

// --- the inventory --------------------------------------------------------

interface Setting {
	name: string;
	source: "WorkspaceSettings" | "MachineSettings" | "docs";
	rustType?: string;
	triState?: boolean;
	locations: Array<"workspace" | "npmrc" | "global" | "env">;
	envFormat?: EnvFormat;
	documented: boolean;
	anchor: string;
	docsDefault?: string;
	docsType?: string;
}

// `_auth` is a field so the global file's structured credentials parse, but
// `apply_to` never reads it from a project file (its doc comment in settings.rs).
const GLOBAL_ONLY_WORKSPACE_FIELDS = new Set(["_auth"]);

const settings = new Map<string, Setting>();
const add = (field: Field, source: Setting["source"], locations: Setting["locations"]): void => {
	if (inert.includes(field.name)) return;
	settings.set(field.name, {
		name: field.name,
		source,
		rustType: field.rustType,
		...(field.triState ? { triState: true } : {}),
		locations,
		...(envFormats.has(field.name) ? { envFormat: envFormats.get(field.name) } : {}),
		documented: false,
		anchor: "",
	});
};
for (const field of workspaceFields) {
	const locations: Setting["locations"] = [];
	if (!projectRefused.has(field.name) && !GLOBAL_ONLY_WORKSPACE_FIELDS.has(field.name)) locations.push("workspace");
	if (npmrcFields.has(field.name)) locations.push("npmrc");
	if (!globalCleared.has(field.name)) locations.push("global");
	if (envFormats.has(field.name)) locations.push("env");
	add(field, "WorkspaceSettings", locations);
}
for (const field of machineFields) {
	const locations: Setting["locations"] = ["global"];
	if (envFormats.has(field.name)) locations.push("env");
	add(field, "MachineSettings", locations);
}
for (const [name, entry] of docs) {
	const known = settings.get(name);
	const docFacts = {
		documented: true,
		anchor: `settings/${entry.page}#${entry.anchor}`,
		...(entry.default === undefined ? {} : { docsDefault: entry.default }),
		...(entry.type === undefined ? {} : { docsType: entry.type }),
	};
	if (known !== undefined) Object.assign(known, docFacts);
	// A documented setting no settings struct carries: pnpm 12 reads it from no source.
	else settings.set(name, { name, source: "docs", locations: [], ...docFacts });
}

const fixture = {
	pnpm: "12.20.0",
	tag: "v12.20.0",
	settings: [...settings.values()].sort((a, b) => a.name.localeCompare(b.name)),
	inert,
	otherVersions,
};

const text = `${JSON.stringify(fixture, null, "\t")}\n`;
if (process.argv.includes("--check")) {
	if (read(FIXTURE) !== text) {
		console.error("the committed fixture differs from a fresh extraction");
		process.exit(1);
	}
	console.log(`fixture current: ${fixture.settings.length} settings`);
} else {
	writeFileSync(FIXTURE, text);
	console.log(`wrote ${fixture.settings.length} settings, ${inert.length} inert`);
}
