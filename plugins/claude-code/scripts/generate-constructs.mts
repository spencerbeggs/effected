// generate-constructs.mts — renders the construct index (effected#188):
// one markdown table per kit package, from the build-emitted api-extractor
// doc models joined with construct-annotations.json. Deterministic: same
// inputs, byte-identical output; construct-index.bats diffs a regeneration
// against the committed files.
//
// Usage:
//   node plugins/claude-code/scripts/generate-constructs.mts generate [--only PKG,...] [--packages DIR] [--out DIR] [--annotations FILE]
//   node plugins/claude-code/scripts/generate-constructs.mts check    [--only PKG,...] [--packages DIR] [--annotations FILE] [--require-intent]
//
// --only confines a run to the named packages (directory names or npm names,
// comma-separated): generate reads and rewrites only their tables, leaving
// every other committed table byte-identical; check validates only their
// annotations (plus the doc models their `implements` links point into).
// Without it, every package is read — so every package's model must be
// current (effected#839).
//
// Exit codes: 0 ok; 1 annotation problems (stale entries, or --require-intent
// unmet) or a usage error; 2 missing doc models ("build first"); 3 stale doc
// models (a package's src/ is newer than its model).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VALUE_KINDS = new Set(["Class", "Variable", "Function", "Enum"]);
const KIND_ORDER = ["Class", "Variable", "Function", "Enum", "Namespace", "Interface", "TypeAlias"];

interface ApiMember {
	readonly kind: string;
	readonly name: string;
	readonly canonicalReference?: string;
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
	readonly srcDir: string;
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

// A bin-only package (exports map with nothing but "./package.json") has no
// import surface, so `emitDts: false` leaves it with no doc model to ever
// join against — exclude it from enumeration rather than reporting it as a
// perpetually missing build.
const isBinOnly = (manifest: { exports?: Record<string, unknown> }): boolean => {
	if (!manifest.exports) return false;
	const keys = Object.keys(manifest.exports);
	return keys.length > 0 && keys.every((key) => key === "./package.json");
};

const listPackages = (packagesDir: string): Pkg[] =>
	readdirSync(packagesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((dir) => existsSync(join(packagesDir, dir, "package.json")))
		.sort()
		.map((dir) => ({
			dir,
			manifest: JSON.parse(readFileSync(join(packagesDir, dir, "package.json"), "utf8")) as {
				name: string;
				exports?: Record<string, unknown>;
			},
		}))
		.filter(({ manifest }) => !isBinOnly(manifest))
		.map(({ dir, manifest }) => ({
			dir,
			name: manifest.name,
			srcDir: join(packagesDir, dir, "src"),
			modelPath: join(packagesDir, dir, "dist", "prod", "npm", "meta", `${dir}.api.json`),
		}));

// Freshness of a doc model is judged by file mtime: the model must be at
// least as new as the newest file under the package's src/. Two alternatives
// were rejected. The `generatedAt` in dist/prod/issues.json is replayed
// verbatim from the turbo cache, so on a fresh CI checkout restored from the
// remote cache it predates every source file and would call every model stale.
// A turbo cache *restore*, by contrast, writes the model anew, so its mtime is
// the restore time. The one blind spot: a cache hit whose outputs are already
// on disk rewrites nothing, so a source file touched without changing (a
// branch switch and back, a rebase) reads as stale until `--force` rebuilds —
// a loud false positive, never a silent wrong table. The guard also cannot
// see a model built by an older toolchain from unchanged source; `--only` is
// the answer there, since it never reads the other packages' models.
interface Staleness {
	readonly modelMtime: Date;
	readonly srcMtime: Date;
	readonly srcFile: string;
}

const stalenessOf = (pkg: Pkg): Staleness | undefined => {
	if (!existsSync(pkg.srcDir)) return undefined;
	const modelMtimeMs = statSync(pkg.modelPath).mtimeMs;
	let newest: { mtimeMs: number; file: string } | undefined;
	for (const rel of readdirSync(pkg.srcDir, { recursive: true, encoding: "utf8" })) {
		const stat = statSync(join(pkg.srcDir, rel));
		if (!stat.isFile()) continue;
		if (newest === undefined || stat.mtimeMs > newest.mtimeMs) newest = { mtimeMs: stat.mtimeMs, file: rel };
	}
	if (newest === undefined || newest.mtimeMs <= modelMtimeMs) return undefined;
	return {
		modelMtime: new Date(modelMtimeMs),
		srcMtime: new Date(newest.mtimeMs),
		srcFile: join("src", newest.file),
	};
};

// Resolve --only against the enumerated packages, by directory or npm name.
const selectPackages = (packages: readonly Pkg[], only: string | boolean | undefined): Pkg[] | string => {
	if (only === undefined) return [...packages];
	if (typeof only !== "string" || only.trim() === "") return "--only needs a comma-separated list of package names";
	const wanted = only
		.split(",")
		.map((name) => name.trim())
		.filter((name) => name !== "");
	const unknown = wanted.filter((name) => !packages.some((pkg) => pkg.dir === name || pkg.name === name));
	if (unknown.length > 0) {
		return `--only names no package with an import surface: ${unknown.join(", ")} (known: ${packages.map((pkg) => pkg.dir).join(", ")})`;
	}
	return packages.filter((pkg) => wanted.includes(pkg.dir) || wanted.includes(pkg.name));
};

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

// api-extractor writes a symbol the entry point never exports — a private
// brand symbol used as a computed key on a public interface, say — into the
// doc model as a "forgotten export", marked with `~` after the `!` in its
// canonical reference (`@scope/pkg!~Name:var`). Nobody can import such a
// symbol, so it is not a construct and must not be asked for an intent. The
// hand-built fixture models carry no canonicalReference; an absent one is
// exported.
const isForgottenExport = (member: ApiMember): boolean => /!~/.test(member.canonicalReference ?? "");

const rowsOf = (modelPath: string, npmName: string): Row[] => {
	const model = JSON.parse(readFileSync(modelPath, "utf8")) as { members: readonly ApiMember[] };
	const entryPoints = model.members ?? [];
	const byName = new Map<string, { kinds: Set<string>; doc: string | undefined; entries: Set<string> }>();
	for (const entryPoint of entryPoints) {
		for (const member of entryPoint.members ?? []) {
			if (isForgottenExport(member)) continue;
			const slot = byName.get(member.name) ?? { kinds: new Set<string>(), doc: undefined, entries: new Set<string>() };
			slot.kinds.add(member.kind);
			if (slot.doc === undefined && member.docComment) slot.doc = member.docComment;
			slot.entries.add(entryPoint.name);
			byName.set(member.name, slot);
		}
	}
	// A class factory's synthesized base (`X_base` beside an exported `X`) is
	// an implementation detail nobody imports, whether or not this doc model's
	// api-extractor vintage marked it forgotten — drop it on the name too, so
	// the index never teaches an agent a heritage symbol exists.
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
	if (command !== "generate" && command !== "check") {
		console.error(`unknown command: ${String(command)} (expected generate|check)`);
		process.exit(1);
	}
	const packagesDir = resolve(String(flags.get("packages") ?? join(repoRoot, "packages")));
	const annotationsPath = resolve(
		String(
			flags.get("annotations") ?? join(repoRoot, "plugins", "claude-code", "scripts", "construct-annotations.json"),
		),
	);
	const allPackages = listPackages(packagesDir);
	const selected = selectPackages(allPackages, flags.get("only"));
	if (typeof selected === "string") {
		console.error(selected);
		process.exit(1);
	}
	const annotations = readAnnotations(annotationsPath);

	// The doc models this run reads: the selected packages, plus — for check —
	// the packages their `implements` links target, which the dangling-link
	// test resolves against. Nothing else is read, so nothing else is judged.
	const readDirs = new Set(selected.map((pkg) => pkg.dir));
	if (command === "check") {
		for (const pkg of selected) {
			for (const annotation of Object.values(annotations[pkg.dir] ?? {})) {
				const targetPkg = annotation.implements?.split(".")[0];
				if (targetPkg !== undefined && allPackages.some((candidate) => candidate.dir === targetPkg)) {
					readDirs.add(targetPkg);
				}
			}
		}
	}
	const packages = allPackages.filter((pkg) => readDirs.has(pkg.dir));

	const missing = packages.filter((pkg) => !existsSync(pkg.modelPath));
	if (missing.length > 0) {
		console.error("build first: no doc model for the following packages (run `pnpm build`):");
		for (const pkg of missing) console.error(`  ${pkg.dir} (expected ${pkg.modelPath})`);
	}
	const stale = packages
		.filter((pkg) => existsSync(pkg.modelPath))
		.flatMap((pkg) => {
			const staleness = stalenessOf(pkg);
			return staleness === undefined ? [] : [{ pkg, staleness }];
		});
	if (stale.length > 0) {
		console.error("stale doc model: these packages' sources are newer than their doc models:");
		for (const { pkg, staleness } of stale) {
			console.error(
				`  ${pkg.dir}: model built ${staleness.modelMtime.toISOString()}, but ${staleness.srcFile} modified ${staleness.srcMtime.toISOString()}`,
			);
		}
		console.error(`rebuild them first: pnpm build ${stale.map(({ pkg }) => `--filter ${pkg.name}`).join(" ")}`);
		console.error(
			"(if a package is still stale after that build, turbo replayed a cache hit onto an unchanged model: the source was touched without changing; add --force)",
		);
		if (flags.get("only") === undefined) {
			console.error("or regenerate just the packages you changed: --only <pkg,...>");
		}
	}
	if (missing.length > 0) process.exit(2);
	if (stale.length > 0) process.exit(3);

	const rowsByPkg = new Map(packages.map((pkg) => [pkg.dir, rowsOf(pkg.modelPath, pkg.name)]));
	// Names come from every manifest, not just the models read, so a
	// cross-package link renders the same whichever packages a run selects.
	const nameByDir = new Map(allPackages.map((pkg) => [pkg.dir, pkg.name]));
	const selectedDirs = new Set(selected.map((pkg) => pkg.dir));

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
			// Under --only, another package's annotations are out of scope; an
			// annotated package that does not exist is reported by a full run.
			if (flags.get("only") !== undefined && !selectedDirs.has(pkg)) continue;
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
				if (!selectedDirs.has(pkg)) continue;
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
				console.error(
					"Author them in plugins/claude-code/scripts/construct-annotations.json (see .claude/skills/constructs).",
				);
				failed = true;
			}
		}
		process.exit(failed ? 1 : 0);
	}

	const outDir = resolve(
		String(
			flags.get("out") ??
				join(repoRoot, "plugins", "claude-code", "skills", "effected-packages", "references", "constructs"),
		),
	);
	mkdirSync(outDir, { recursive: true });
	for (const pkg of selected) {
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
