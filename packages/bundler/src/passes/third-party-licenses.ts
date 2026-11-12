import { Context, Effect, FileSystem, Option, Path } from "effect";
import type { Plugin } from "rolldown";

/** The file a build writes beside its manifest when it inlined another package's code. */
export const THIRD_PARTY_LICENSES = "THIRD_PARTY_LICENSES.txt";

/** One inlined package and its notice. */
export interface InlinedPackage {
	readonly name: string;
	readonly version: string;
	readonly license: string;
	/** The text of the package's licence and notice files, in name order; empty when it ships none. */
	readonly notices: ReadonlyArray<{ readonly file: string; readonly text: string }>;
}

/** A licence or notice file by the names packages ship them under. */
const NOTICE_FILE = /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i;

/**
 * Renders the notices file: one section per package, sorted by name and version, each with its declared licence and
 * the text of every licence or notice file it ships.
 *
 * @internal
 */
export const renderThirdPartyLicenses = (packageName: string, packages: ReadonlyArray<InlinedPackage>): string => {
	const sorted = [...packages].sort((a, b) =>
		a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
	);
	const rule = "-".repeat(80);
	const sections = sorted.map((pkg) => {
		const head = `${pkg.name}@${pkg.version}\nLicense: ${pkg.license}`;
		const body =
			pkg.notices.length === 0
				? "(no licence file is shipped with this package)"
				: pkg.notices.map((notice) => `${notice.file}:\n\n${notice.text.trimEnd()}`).join("\n\n");
		return `${rule}\n${head}\n\n${body}\n`;
	});
	return `${packageName} includes code from the following packages, inlined at build time.\n\n${sections.join("\n")}`;
};

/** @public */
export interface ThirdPartyLicensesOptions {
	/** The package being built; its own modules are not third-party. */
	readonly cwd: string;
	/** The package name the notices file is headed with. */
	readonly packageName: string;
	/**
	 * Packages already found by an earlier pass of the same output directory. Each pass adds what it inlined and writes
	 * the whole set, so the last pass to write the file names every partition's packages.
	 */
	readonly found: Map<string, InlinedPackage>;
}

/**
 * Rolldown plugin: writes {@link THIRD_PARTY_LICENSES} when the JS pass inlined code from any other package.
 *
 * @remarks
 * Every module in the output whose nearest `package.json` belongs to another package is that package's code, a
 * workspace sibling's or a registry package's, and the file carries its name, version, declared licence and the text
 * of the licence and notice files it ships, so the notices travel with the code. A pass that inlined nothing, the
 * usual per-module build, writes no file.
 *
 * rolldown calls `generateBundle` as a plain async hook, so the plugin captures the `FileSystem` and `Path` it is built
 * under.
 *
 * @public
 */
export const thirdPartyLicenses = (
	options: ThirdPartyLicensesOptions,
): Effect.Effect<Plugin, never, FileSystem.FileSystem | Path.Path> =>
	Effect.map(Effect.context<FileSystem.FileSystem | Path.Path>(), (services) =>
		thirdPartyLicensesWith(options, services),
	);

interface Manifest {
	readonly name?: unknown;
	readonly version?: unknown;
	readonly license?: unknown;
}

const thirdPartyLicensesWith = (
	options: ThirdPartyLicensesOptions,
	services: Context.Context<FileSystem.FileSystem | Path.Path>,
): Plugin => {
	const run = Effect.runPromiseWith(services);
	const path = Context.get(services, Path.Path);

	/** The directory and manifest of the package owning `directory`, walking up to the nearest named package. */
	const ownerOf = (
		directory: string,
	): Effect.Effect<Option.Option<readonly [string, Manifest]>, never, FileSystem.FileSystem> =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const text = yield* fs.readFileString(path.join(directory, "package.json")).pipe(Effect.option);
			if (Option.isSome(text)) {
				const manifest = yield* Effect.try(() => JSON.parse(text.value) as Manifest).pipe(Effect.option);
				if (Option.isSome(manifest) && typeof manifest.value.name === "string") {
					return Option.some([directory, manifest.value] as const);
				}
			}
			const parent = path.dirname(directory);
			return parent === directory ? Option.none() : yield* ownerOf(parent);
		});

	const describe = (
		directory: string,
		manifest: Manifest,
	): Effect.Effect<InlinedPackage, never, FileSystem.FileSystem> =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const entries = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []));
			const notices: Array<{ readonly file: string; readonly text: string }> = [];
			for (const file of [...entries].filter((entry) => NOTICE_FILE.test(entry)).sort()) {
				const text = yield* fs.readFileString(path.join(directory, file)).pipe(Effect.option);
				if (Option.isSome(text)) notices.push({ file, text: text.value });
			}
			return {
				name: String(manifest.name),
				version: typeof manifest.version === "string" ? manifest.version : "unknown",
				license: typeof manifest.license === "string" ? manifest.license : "UNKNOWN",
				notices,
			};
		});

	return {
		name: "effected:third-party-licenses",
		async generateBundle(_output, bundle) {
			const ids = new Set<string>();
			for (const chunk of Object.values(bundle)) {
				if (chunk.type !== "chunk") continue;
				for (const id of chunk.moduleIds) if (!id.startsWith("\0") && path.isAbsolute(id)) ids.add(id);
			}
			await run(
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const self = yield* fs.realPath(options.cwd).pipe(Effect.orElseSucceed(() => options.cwd));
					const seen = new Set<string>();
					for (const id of ids) {
						const directory = path.dirname(id.split("?")[0] ?? id);
						if (seen.has(directory)) continue;
						seen.add(directory);
						const owner = yield* ownerOf(directory);
						if (Option.isNone(owner)) continue;
						const [root, manifest] = owner.value;
						if (root === self || root === options.cwd) continue;
						const key = `${String(manifest.name)}@${String(manifest.version)}`;
						if (!options.found.has(key)) options.found.set(key, yield* describe(root, manifest));
					}
				}),
			);
			if (options.found.size === 0) return;
			this.emitFile({
				type: "asset",
				fileName: THIRD_PARTY_LICENSES,
				source: renderThirdPartyLicenses(options.packageName, [...options.found.values()]),
			});
		},
	};
};
