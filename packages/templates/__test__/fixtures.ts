import { assert } from "@effect/vitest";
import type { Layer } from "effect";
import { Effect, FileSystem, PlatformError, Result } from "effect";
import type { SectionParseError } from "../src/index.js";
import { CommentStyle, SectionDialect, SectionDocument, SectionId } from "../src/index.js";

/** A writable in-memory filesystem, built fresh per test. */
export interface MemoryFs {
	readonly files: Map<string, string>;
	/** How many times `writeFileString` actually ran. */
	readonly writes: () => number;
	readonly layer: Layer.Layer<FileSystem.FileSystem>;
}

const systemError = (tag: "NotFound" | "PermissionDenied", method: string, path: string) =>
	new PlatformError.PlatformError(
		new PlatformError.SystemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: path }),
	);

/**
 * An in-memory `FileSystem` over a `Map`.
 *
 * @remarks
 * Every operation is wrapped in `Effect.suspend` so it observes the map as it
 * is when the effect RUNS. An eager implementation would capture state at
 * construction time and record calls that never actually happened.
 *
 * The double is mutable, so each test builds its own and provides it at the
 * test boundary — a suite-level `layer(...)` cannot vary per test.
 */
export const memoryFs = (
	initial: Record<string, string> = {},
	options: { readonly unreadable?: string; readonly unwritable?: string } = {},
): MemoryFs => {
	const files = new Map(Object.entries(initial));
	let writeCount = 0;
	const layer = FileSystem.layerNoop({
		// `ManagedSection` reads BYTES (so a BOM survives decoding), so the double
		// must implement `readFile`. Implementing only `readFileString` would leave
		// `readFile` unimplemented, and `layerNoop` fails unimplemented members with
		// a typed NotFound — which this package treats as "the file is absent", so
		// every test would silently see an empty document instead of its fixture.
		readFile: (path) =>
			Effect.suspend(() => {
				const key = String(path);
				if (options.unreadable === key) {
					return Effect.fail(systemError("PermissionDenied", "readFile", key));
				}
				const content = files.get(key);
				return content === undefined
					? Effect.fail(systemError("NotFound", "readFile", key))
					: Effect.succeed(new TextEncoder().encode(content));
			}),
		writeFileString: (path, data) =>
			Effect.suspend(() => {
				const key = String(path);
				if (options.unwritable === key) {
					return Effect.fail(systemError("PermissionDenied", "writeFileString", key));
				}
				writeCount += 1;
				files.set(key, data);
				return Effect.void;
			}),
	});
	return { files, writes: () => writeCount, layer };
};

/** A section identity in the default `#` style. */
export const id = (key: string) => SectionId.make({ key, commentStyle: CommentStyle.hash });

/** A section in the default `#` style. */
export const section = (key: string, content: string) => id(key).section(content);

export const begin = (key: string) => `# --- BEGIN ${key} MANAGED SECTION ---`;
export const end = (key: string) => `# --- END ${key} MANAGED SECTION ---`;

/** A rendered block as it appears in a document. */
export const block = (key: string, content: string) => [begin(key), content, end(key)].join("\n");

/** Join lines with LF; the trailing newline is explicit at each call site. */
export const lines = (...parts: ReadonlyArray<string>) => parts.join("\n");

/** Rewrite an LF fixture as CRLF. */
export const crlf = (text: string) => text.replace(/\n/g, "\r\n");

export const parse = (text: string, dialect: SectionDialect = SectionDialect.default): SectionDocument => {
	const result = SectionDocument.parseResult(text, dialect);
	if (!Result.isSuccess(result)) {
		assert.fail(`expected a parseable document, got ${result.failure.reason} at line ${result.failure.line}`);
	}
	return result.success;
};

export const parseFailure = (text: string, dialect: SectionDialect = SectionDialect.default): SectionParseError => {
	const result = SectionDocument.parseResult(text, dialect);
	if (!Result.isFailure(result)) {
		assert.fail("expected the document to be rejected");
	}
	return result.failure;
};
