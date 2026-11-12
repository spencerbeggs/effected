import { Context, Effect, FileSystem, Option, Path } from "effect";
import type { Plugin } from "rolldown";

/** The exact expression the build defines; a package reads its own version through it. */
export const VERSION_EXPRESSION = "process.env.__PACKAGE_VERSION__";

/** A span of source to replace, as UTF-16 offsets. */
interface Span {
	readonly start: number;
	readonly end: number;
}

const isNode = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && typeof (value as { readonly type?: unknown }).type === "string";

const isIdentifier = (node: unknown, name: string): boolean =>
	isNode(node) && node.type === "Identifier" && node.name === name;

/** `process.env.__PACKAGE_VERSION__` as a member expression, written the way `define` matches it: no computed access. */
const isVersionExpression = (node: Record<string, unknown>): boolean => {
	if (
		node.type !== "MemberExpression" ||
		node.computed === true ||
		!isIdentifier(node.property, "__PACKAGE_VERSION__")
	) {
		return false;
	}
	const object = node.object;
	return (
		isNode(object) &&
		object.type === "MemberExpression" &&
		object.computed !== true &&
		isIdentifier(object.object, "process") &&
		isIdentifier(object.property, "env")
	);
};

/** Every occurrence of the expression in a program, outermost first, never descending into one it took. */
const collectSpans = (root: unknown): ReadonlyArray<Span> => {
	const spans: Array<Span> = [];
	const stack: Array<unknown> = [root];
	while (stack.length > 0) {
		const value = stack.pop();
		if (Array.isArray(value)) {
			for (const item of value) stack.push(item);
			continue;
		}
		if (!isNode(value)) continue;
		if (isVersionExpression(value) && typeof value.start === "number" && typeof value.end === "number") {
			spans.push({ start: value.start, end: value.end });
			continue;
		}
		for (const [key, child] of Object.entries(value)) {
			if (key !== "type" && typeof child === "object" && child !== null) stack.push(child);
		}
	}
	return spans;
};

/**
 * Replaces each `process.env.__PACKAGE_VERSION__` expression in `code` with a string literal of `version`, leaving
 * strings, comments and other spellings alone, as the build's `define` does. `undefined` when nothing matched.
 *
 * @param parse - a parser answering an ESTree program, with UTF-16 offsets, for a file name and its source
 *
 * @internal
 */
export const stampSource = (
	code: string,
	filename: string,
	version: string,
	parse: (filename: string, code: string) => unknown,
): string | undefined => {
	if (!code.includes(VERSION_EXPRESSION)) return undefined;
	const spans = [...collectSpans(parse(filename, code))].sort((a, b) => b.start - a.start);
	if (spans.length === 0) return undefined;
	let out = code;
	const literal = JSON.stringify(version);
	for (const { start, end } of spans) out = `${out.slice(0, start)}${literal}${out.slice(end)}`;
	return out;
};

/** The package that owns a module: the nearest directory above it holding a `package.json` with a name and a version. */
interface Owner {
	readonly directory: string;
	readonly version: string | undefined;
}

/** @public */
export interface StampVersionsOptions {
	/** The package being built. Its own modules keep the build's `define`. */
	readonly cwd: string;
}

/**
 * Rolldown plugin: stamps every inlined module of ANOTHER package with that package's own version.
 *
 * @remarks
 * The build defines `process.env.__PACKAGE_VERSION__` as the built package's version, and `define` applies to every
 * module in the bundle. A workspace sibling or a registry package inlined by `bundle` or `bundleNodeModules` reads the
 * same expression for its own version, so without this it would report the bundling package's. This hook runs before
 * the native transform that applies `define`, finds the nearest `package.json` above each module that spells the
 * expression and, when that is not the package being built, writes the owner's version in its place. A module whose
 * owner has no version is left to `define`.
 *
 * rolldown calls `transform` as a plain async hook, so the plugin captures the `FileSystem` and `Path` it is built under.
 *
 * @public
 */
export const stampVersions = (
	options: StampVersionsOptions,
): Effect.Effect<Plugin, never, FileSystem.FileSystem | Path.Path> =>
	Effect.map(Effect.context<FileSystem.FileSystem | Path.Path>(), (services) => stampVersionsWith(options, services));

const stampVersionsWith = (
	options: StampVersionsOptions,
	services: Context.Context<FileSystem.FileSystem | Path.Path>,
): Plugin => {
	const run = Effect.runPromiseWith(services);
	const path = Context.get(services, Path.Path);
	const owners = new Map<string, Promise<Option.Option<Owner>>>();

	const ownerOf = (directory: string): Promise<Option.Option<Owner>> => {
		const cached = owners.get(directory);
		if (cached !== undefined) return cached;
		const found = run(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const text = yield* fs.readFileString(path.join(directory, "package.json")).pipe(Effect.option);
				if (Option.isSome(text)) {
					const manifest = yield* Effect.try(() => JSON.parse(text.value) as { readonly version?: unknown }).pipe(
						Effect.option,
					);
					const version = Option.flatMap(manifest, (m) =>
						typeof m.version === "string" ? Option.some(m.version) : Option.none(),
					);
					return Option.some<Owner>({ directory, version: Option.getOrUndefined(version) });
				}
				const parent = path.dirname(directory);
				return parent === directory ? Option.none<Owner>() : yield* Effect.promise(() => ownerOf(parent));
			}),
		);
		owners.set(directory, found);
		return found;
	};

	const self = run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			return yield* fs.realPath(options.cwd).pipe(Effect.orElseSucceed(() => options.cwd));
		}),
	);

	let parser: Promise<(filename: string, code: string) => unknown> | undefined;
	const parse = (): Promise<(filename: string, code: string) => unknown> => {
		parser ??= import("rolldown/utils").then(
			({ parseSync }) =>
				(filename: string, code: string) =>
					parseSync(filename, code).program,
		);
		return parser;
	};

	return {
		name: "effected:stamp-versions",
		transform: {
			filter: { code: VERSION_EXPRESSION },
			async handler(code, id) {
				if (id.startsWith("\0") || !code.includes(VERSION_EXPRESSION)) return null;
				const file = id.split("?")[0] ?? id;
				const owner = await ownerOf(path.dirname(file));
				if (Option.isNone(owner) || owner.value.directory === (await self) || owner.value.version === undefined) {
					return null;
				}
				const stamped = stampSource(code, file, owner.value.version, await parse());
				return stamped === undefined ? null : { code: stamped, map: null };
			},
		},
	};
};
