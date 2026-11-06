import { TomlCodec } from "@effected/config-file/toml";
import { WorkspaceDiscovery } from "@effected/workspaces";
import { Effect, FileSystem, Path, Predicate, Schema, SchemaIssue } from "effect";
import { causeMessage } from "../internal/causeMessage.js";
import { EffectedConfig, PackageConfig } from "./BuildConfig.js";
import { merge } from "./merge.js";

/** Root tier candidates, first found wins. */
const ROOT_CANDIDATES = [".config/effected.toml", "effected.toml"];

/** Package tier candidates, first found wins. */
const PACKAGE_CANDIDATES = [".config/effected.toml", "effected.toml", "lib/configs/effected.toml"];

/**
 * An `effected.toml` could not be read, parsed or decoded, or the workspace around it could not be discovered.
 *
 * @public
 */
export class EffectedConfigError extends Schema.TaggedError<EffectedConfigError>()("EffectedConfigError", {
	/** The file at fault. */
	path: Schema.String,
	/** The TOML parser's message, or every schema issue rendered with its path. */
	reason: Schema.String,
	/** The dotted path of the first schema issue, e.g. `package.build.formats`, when decoding failed. */
	issuePath: Schema.optionalKey(Schema.String),
}) {
	override get message(): string {
		return `Invalid effected config at ${this.path}: ${this.reason}`;
	}
}

/**
 * The effective config {@link EffectedConfigFile.load} answers: an {@link EffectedConfig} whose `package` table
 * is always present, with every default when no file wrote one, so a consumer never branches on its absence.
 *
 * @public
 */
export class ResolvedConfig extends EffectedConfig.extend<ResolvedConfig>("ResolvedConfig")({
	/** The package tables. */
	package: PackageConfig.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
}) {}

/**
 * A package's effective `effected.toml` config and the files it came from.
 *
 * @public
 */
export class ResolvedEffectedConfig extends Schema.Class<ResolvedEffectedConfig>("ResolvedEffectedConfig")({
	/** The merged, decoded config. */
	config: ResolvedConfig,
	/** The file each tier read, absent for a tier that found none. */
	sources: Schema.Struct({
		/** The workspace root tier's file. */
		root: Schema.optionalKey(Schema.String),
		/** The package tier's file. */
		package: Schema.optionalKey(Schema.String),
	}),
}) {}

/** A found candidate and its raw document. */
interface Tier {
	readonly path: string;
	readonly document: unknown;
}

/** The first candidate that exists, parsed. Absence moves on; any other read failure is the file's fault. */
const readFirst = Effect.fnUntraced(function* (directory: string, candidates: ReadonlyArray<string>) {
	const fs = yield* FileSystem.FileSystem;
	const pathService = yield* Path.Path;
	for (const candidate of candidates) {
		const path = pathService.join(directory, candidate);
		const raw = yield* fs.readFileString(path).pipe(
			Effect.map((text): string | undefined => text),
			Effect.catchTag("PlatformError", (error) =>
				error.reason._tag === "NotFound"
					? Effect.succeed(undefined)
					: Effect.fail(new EffectedConfigError({ path, reason: causeMessage(error) ?? String(error) })),
			),
		);
		if (raw !== undefined) {
			const document = yield* TomlCodec.parse(raw).pipe(
				Effect.mapError((error) => new EffectedConfigError({ path, reason: causeMessage(error) ?? String(error) })),
			);
			return { path, document } satisfies Tier;
		}
	}
	return undefined;
});

/** How many leading segments of `segments` a raw document actually has. */
const depthIn = (document: unknown, segments: ReadonlyArray<PropertyKey>): number => {
	let node = document;
	let depth = 0;
	for (const segment of segments) {
		if (typeof node !== "object" || node === null || !Object.hasOwn(node, segment)) break;
		node = (node as Record<PropertyKey, unknown>)[segment];
		depth++;
	}
	return depth;
};

/**
 * The tier that wrote what an issue points at: the one reaching furthest along its path.
 *
 * @remarks
 * A tier that contains the key reaches further than one that does not, so a tie means both contain it or
 * neither does. The package takes a tie: when both contain it the package's value is the one that decoded, and
 * for a missing required key both tables are equally incomplete.
 */
const blame = (
	segments: ReadonlyArray<PropertyKey>,
	root: Tier | undefined,
	pkg: Tier | undefined,
	fallback: string,
): string => {
	if (root === undefined || pkg === undefined) return pkg?.path ?? root?.path ?? fallback;
	return depthIn(root.document, segments) > depthIn(pkg.document, segments) ? root.path : pkg.path;
};

const dotted = (segments: ReadonlyArray<PropertyKey>): string => segments.map(String).join(".");

/** Every issue under a schema failure, as its property keys and message. */
const issuesOf = (issue: SchemaIssue.Issue) =>
	SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues.map(({ message, path = [] }) => ({
		message,
		keys: path.map((segment) => (typeof segment === "object" ? segment.key : segment)),
	}));

/**
 * Finds, merges and decodes `effected.toml`.
 *
 * @public
 */
export class EffectedConfigFile {
	private constructor() {}

	/**
	 * Loads the config that applies to the package at `cwd`.
	 *
	 * @remarks
	 * The root tier is the first of `.config/effected.toml` and `effected.toml` under the workspace root. The
	 * package tier is the first of those two and `lib/configs/effected.toml` under `cwd`; it applies only when
	 * `cwd` is not the root. The package tier merges over the root tier per {@link merge}, and the merged
	 * document decodes once, so defaults apply after precedence.
	 *
	 * Decoding rejects unknown keys and reports all of them. When no workspace root sits above `cwd`, `cwd`
	 * is the root. No file anywhere is not a failure: `config.package` holds every default and `sources` has no
	 * keys.
	 *
	 * @param options - `cwd` is the package directory; `root` skips workspace discovery.
	 */
	static readonly load = Effect.fn("EffectedConfigFile.load")(function* (options: {
		readonly cwd: string;
		readonly root?: string;
	}) {
		const pathService = yield* Path.Path;
		const cwd = pathService.resolve(options.cwd);
		const rootDirectory =
			options.root !== undefined
				? pathService.resolve(options.root)
				: yield* WorkspaceDiscovery.use((discovery) => discovery.infoIn(cwd)).pipe(
						Effect.map((info) => info.root),
						Effect.catchTag("WorkspaceRootNotFoundError", () => Effect.succeed(cwd)),
						Effect.mapError(
							(error) =>
								new EffectedConfigError({
									path: Predicate.hasProperty(error, "path") && Predicate.isString(error.path) ? error.path : cwd,
									reason: causeMessage(error) ?? String(error),
								}),
						),
					);

		const root = yield* readFirst(rootDirectory, ROOT_CANDIDATES);
		const pkg = rootDirectory === cwd ? undefined : yield* readFirst(cwd, PACKAGE_CANDIDATES);

		const config = yield* Schema.decodeUnknownEffect(ResolvedConfig)(merge(root?.document ?? {}, pkg?.document ?? {}), {
			onExcessProperty: "error",
			errors: "all",
		}).pipe(
			Effect.mapError((error) => {
				const issues = issuesOf(error.issue);
				const first = issues[0]?.keys ?? [];
				return new EffectedConfigError({
					path: blame(first, root, pkg, cwd),
					reason: issues.map(({ keys, message }) => `${dotted(keys)}: ${message}`).join("; "),
					...(first.length > 0 ? { issuePath: dotted(first) } : {}),
				});
			}),
		);

		return ResolvedEffectedConfig.make({
			config,
			sources: {
				...(root !== undefined ? { root: root.path } : {}),
				...(pkg !== undefined ? { package: pkg.path } : {}),
			},
		});
	});
}
