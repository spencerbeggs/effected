// generate-constructs.mts — renders the construct index (effected#188):
// one markdown table per kit package, from the build-emitted api-extractor
// doc models joined with construct-annotations.json. Deterministic: same
// inputs, byte-identical output; construct-index.bats diffs a regeneration
// against the committed files.
//
// Usage:
//   node plugins/claude-code/scripts/generate-constructs.mts generate [--packages DIR] [--out DIR] [--annotations FILE]
//   node plugins/claude-code/scripts/generate-constructs.mts check    [--packages DIR] [--annotations FILE] [--require-intent]
//
// Exit codes: 0 ok; 1 annotation problems (stale entries, or --require-intent
// unmet); 2 missing doc models ("build first").
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VALUE_KINDS = new Set(["Class", "Variable", "Function", "Enum"]);
const KIND_ORDER = ["Class", "Variable", "Function", "Enum", "Namespace", "Interface", "TypeAlias"];

interface ApiMember {
	readonly kind: string;
	readonly name: string;
	readonly docComment?: string;
	readonly members?: readonly ApiMember[];
}

interface Annotation {
	readonly intent: string;
	readonly implements?: string;
}

interface Row {
	readonly name: string;
	readonly kinds: readonly string[];
	readonly purpose: string;
	readonly required: boolean;
	// Set only when this name appears exclusively in non-root entry points —
	// the derived qualifier rendered as the first intent-cell part.
	readonly fromEntry?: string;
}

interface Pkg {
	readonly dir: string;
	readonly name: string;
	readonly modelPath: string;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const parseArgs = (argv: readonly string[]) => {
	const [command, ...rest] = argv;
	const flags = new Map<string, string | boolean>();
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (!arg.startsWith("--")) continue;
		const next = rest[i + 1];
		if (next !== undefined && !next.startsWith("--")) {
			flags.set(arg.slice(2), next);
			i++;
		} else {
			flags.set(arg.slice(2), true);
		}
	}
	return { command, flags };
};

const listPackages = (packagesDir: string): Pkg[] =>
	readdirSync(packagesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((dir) => existsSync(join(packagesDir, dir, "package.json")))
		.sort()
		.map((dir) => ({
			dir,
			name: (JSON.parse(readFileSync(join(packagesDir, dir, "package.json"), "utf8")) as { name: string }).name,
			modelPath: join(packagesDir, dir, "dist", "prod", "npm", "meta", `${dir}.api.json`),
		}));

// {@link Target} -> `Target`; {@link Target | label} / {@link Target|label} -> `label`.
const LINK_RE = /\{@link\s+([^\s|}]+)(?:\s*\|\s*([^}]+))?\}/g;

// First paragraph of a TSDoc comment: strip the frame, stop at the first
// blank line, block tag, or code fence. Link macros unwrap to a backticked
// name; pipes are escaped so the markdown table survives.
const summaryOf = (doc: string | undefined): string => {
	if (!doc) return "";
	const lines = doc.split("\n").map((line) => line.replace(/^\s*\/?\*+\/?\s?/, "").trimEnd());
	const summary: string[] = [];
	for (const line of lines) {
		const text = line.trim();
		if (text.startsWith("```")) break;
		if (text.startsWith("@")) break;
		if (text === "" && summary.length > 0) break;
		if (text !== "") summary.push(text);
	}
	return summary
		.join(" ")
		.replace(LINK_RE, (_match, target: string, label: string | undefined) => `\`${(label ?? target).trim()}\``)
		.replace(/\\/g, "\\\\")
		.replace(/\|/g, "\\|");
};

const rowsOf = (modelPath: string, npmName: string): Row[] => {
	const model = JSON.parse(readFileSync(modelPath, "utf8")) as { members: readonly ApiMember[] };
	const entryPoints = model.members ?? [];
	const byName = new Map<string, { kinds: Set<string>; doc: string | undefined; entries: Set<string> }>();
	for (const entryPoint of entryPoints) {
		for (const member of entryPoint.members ?? []) {
			const slot = byName.get(member.name) ?? { kinds: new Set<string>(), doc: undefined, entries: new Set<string>() };
			slot.kinds.add(member.kind);
			if (slot.doc === undefined && member.docComment) slot.doc = member.docComment;
			slot.entries.add(entryPoint.name);
			byName.set(member.name, slot);
		}
	}
	for (const name of [...byName.keys()]) {
		if (name.endsWith("_base") && byName.has(name.slice(0, -5))) byName.delete(name);
	}
	return [...byName.entries()]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([name, slot]) => {
			const kinds = [...slot.kinds].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
			// Root entry ("") always wins the qualifier: only a name confined to
			// non-root entry points gets a derived "from `pkg/entry`" part.
			const nonRootEntry = slot.entries.has("") ? undefined : [...slot.entries].sort()[0];
			return {
				name,
				kinds,
				purpose: summaryOf(slot.doc),
				required: kinds.some((kind) => VALUE_KINDS.has(kind)),
				...(nonRootEntry === undefined ? {} : { fromEntry: `from \`${npmName}/${nonRootEntry}\`` }),
			};
		});
};

type Annotations = Record<string, Record<string, Annotation>>;

const readAnnotations = (path: string): Annotations => {
	const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, Record<string, string | Annotation>>;
	const normalized: Record<string, Record<string, Annotation>> = {};
	for (const [pkg, constructs] of Object.entries(raw)) {
		normalized[pkg] = {};
		for (const [name, value] of Object.entries(constructs)) {
			normalized[pkg][name] = typeof value === "string" ? { intent: value } : value;
		}
	}
	return normalized;
};

const main = () => {
	const { command, flags } = parseArgs(process.argv.slice(2));
	const packagesDir = resolve(String(flags.get("packages") ?? join(repoRoot, "packages")));
	const annotationsPath = resolve(
		String(flags.get("annotations") ?? join(repoRoot, "plugins", "claude-code", "scripts", "construct-annotations.json")),
	);
	const packages = listPackages(packagesDir);

	const missing = packages.filter((pkg) => !existsSync(pkg.modelPath));
	if (missing.length > 0) {
		console.error("build first: no doc model for the following packages (run `pnpm build`):");
		for (const pkg of missing) console.error(`  ${pkg.dir} (expected ${pkg.modelPath})`);
		process.exit(2);
	}

	const annotations = readAnnotations(annotationsPath);
	const rowsByPkg = new Map(packages.map((pkg) => [pkg.dir, rowsOf(pkg.modelPath, pkg.name)]));
	const nameByDir = new Map(packages.map((pkg) => [pkg.dir, pkg.name]));

	// Invert `implements` links so the contract side names its implementations.
	const implementedBy = new Map<string, { pkg: string; name: string }[]>();
	for (const [pkg, constructs] of Object.entries(annotations)) {
		for (const [name, annotation] of Object.entries(constructs)) {
			if (!annotation.implements) continue;
			const list = implementedBy.get(annotation.implements) ?? [];
			list.push({ pkg, name });
			implementedBy.set(annotation.implements, list);
		}
	}

	if (command === "check") {
		let failed = false;
		for (const [pkg, constructs] of Object.entries(annotations)) {
			const rows = rowsByPkg.get(pkg);
			if (!rows) {
				console.error(`stale annotations: package \`${pkg}\` does not exist`);
				failed = true;
				continue;
			}
			const names = new Set(rows.map((row) => row.name));
			for (const [name, annotation] of Object.entries(constructs)) {
				if (!names.has(name)) {
					console.error(`stale annotation: ${pkg}.${name} is no longer exported`);
					failed = true;
				}
				if (annotation.implements) {
					const [targetPkg, targetName] = annotation.implements.split(".");
					const targetNames = rowsByPkg.get(targetPkg ?? "")?.map((row) => row.name);
					if (!targetNames?.includes(targetName ?? "")) {
						console.error(`dangling implements: ${pkg}.${name} -> ${annotation.implements}`);
						failed = true;
					}
				}
			}
		}
		if (flags.get("require-intent") === true) {
			let unannotated = 0;
			for (const [pkg, rows] of rowsByPkg) {
				for (const row of rows) {
					const intent = annotations[pkg]?.[row.name]?.intent;
					if (row.required && (intent === undefined || intent.trim() === "")) {
						console.error(`missing intent annotation: ${pkg}.${row.name} (${row.kinds.join(" + ")})`);
						unannotated++;
					}
				}
			}
			if (unannotated > 0) {
				console.error(`\n${unannotated} value-kind constructs lack an intent annotation.`);
				console.error("Author them in plugins/claude-code/scripts/construct-annotations.json (see .claude/skills/constructs).");
				failed = true;
			}
		}
		process.exit(failed ? 1 : 0);
	}

	if (command !== "generate") {
		console.error(`unknown command: ${String(command)} (expected generate|check)`);
		process.exit(1);
	}

	const outDir = resolve(
		String(flags.get("out") ?? join(repoRoot, "plugins", "claude-code", "skills", "effected-packages", "references", "constructs")),
	);
	mkdirSync(outDir, { recursive: true });
	for (const pkg of packages) {
		const rows = rowsByPkg.get(pkg.dir) ?? [];
		const lines: string[] = [
			`# ${nameByDir.get(pkg.dir)} constructs`,
			"",
			"<!-- GENERATED by plugins/claude-code/scripts/generate-constructs.mts — do not edit.",
			"     Edit plugins/claude-code/scripts/construct-annotations.json and regenerate. -->",
			"",
			"| Construct | Kind | Purpose | Reach for it when |",
			"| --- | --- | --- | --- |",
		];
		for (const row of rows) {
			const annotation = annotations[pkg.dir]?.[row.name];
			const parts: string[] = [];
			if (row.fromEntry) parts.push(row.fromEntry);
			if (annotation?.intent) parts.push(annotation.intent);
			if (annotation?.implements) {
				const [targetPkg, targetName] = annotation.implements.split(".");
				parts.push(`implements \`${targetName}\` from \`${nameByDir.get(targetPkg) ?? targetPkg}\``);
			}
			for (const impl of implementedBy.get(`${pkg.dir}.${row.name}`) ?? []) {
				parts.push(`implemented by \`${impl.name}\` in \`${nameByDir.get(impl.pkg) ?? impl.pkg}\``);
			}
			const cells = [
				`\`${row.name}\``,
				row.kinds.join(" + "),
				row.purpose,
				parts.join(" — ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|"),
			];
			lines.push(`|${cells.map((cell) => (cell === "" ? " " : ` ${cell} `)).join("|")}|`);
		}
		lines.push("");
		writeFileSync(join(outDir, `${pkg.dir}.md`), lines.join("\n"));
	}
};

main();
