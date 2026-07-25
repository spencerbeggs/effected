// The emitter facade.
//
// `generate` and `toJson` are plain total functions. The package this replaces
// typed both as `Effect<_, SbomError>` with `reason: "build" | "serialize"`,
// but those arms described failures that could only come from the CycloneDX
// library throwing — a possibility introduced BY the dependency. Owning the
// model removes the failure, so the error channel goes with it. Only `write`
// keeps one, and it is the filesystem's.

import { Effect, FileSystem, Schema } from "effect";
import type { Component } from "./SbomDocument.js";
import { BOM_FORMAT, SPEC_VERSION, SbomDocument, SbomMetadata, documentJson } from "./SbomDocument.js";

/**
 * Input to {@link Sbom.generate}.
 *
 * @public
 */
export interface SbomInput {
	/** The component the BOM is about. */
	readonly root: Component;
	/** Its dependencies, in any order — the document sorts them. */
	readonly components: ReadonlyArray<Component>;
	/** Document metadata. `root` is threaded onto it automatically. */
	readonly metadata?: SbomMetadata;
}

/**
 * Options for {@link Sbom.toJson}.
 *
 * @public
 */
export interface SbomJsonOptions {
	/** `JSON.stringify` indentation. Defaults to `2`; `0` emits one line. */
	readonly space?: number;
}

/**
 * Raised when a BOM cannot be written to disk.
 *
 * @remarks
 * The package's **only** error, and it is the filesystem's rather than the
 * emitter's — assembling and serializing a document cannot fail.
 *
 * @public
 */
export class SbomWriteError extends Schema.TaggedErrorClass<SbomWriteError>()("SbomWriteError", {
	/** The path that could not be written. */
	path: Schema.String,
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Failed to write the SBOM to ${this.path}`;
	}
}

/**
 * Assemble a CycloneDX 1.6 document.
 *
 * @remarks
 * **Total** — no error channel, because there is nothing here that can fail.
 * Components are sorted by name so two runs over the same inputs produce the
 * same bytes: an SBOM's digest becomes an attestation subject, and a document
 * that reordered itself between runs would change that digest for no reason.
 */
const generate = (input: SbomInput): SbomDocument =>
	SbomDocument.make({
		bomFormat: BOM_FORMAT,
		specVersion: SPEC_VERSION,
		version: 1,
		metadata: metadataWithRoot(input),
		components: [...input.components].sort((a, b) => a.name.localeCompare(b.name)),
	});

/**
 * Thread the root component onto the caller's metadata, or synthesize metadata
 * carrying it.
 *
 * Rebuilt through `SbomMetadata.make` rather than spread into a plain object:
 * a spread of a `Schema.Class` instance loses its prototype, and a plain object
 * standing in for a class field is the kind of lie that works until something
 * asks whether it is an instance. The conditional spreads are required by
 * `exactOptionalPropertyTypes` — an explicit `undefined` does not satisfy an
 * `optionalKey` field.
 */
const metadataWithRoot = (input: SbomInput): SbomMetadata =>
	SbomMetadata.make({
		component: input.root,
		...(input.metadata?.timestamp !== undefined && { timestamp: input.metadata.timestamp }),
		...(input.metadata?.authors !== undefined && { authors: input.metadata.authors }),
		...(input.metadata?.supplier !== undefined && { supplier: input.metadata.supplier }),
	});

/**
 * Serialize a document to canonical CycloneDX 1.6 JSON.
 *
 * @remarks
 * **Total.** Absent optional fields are omitted rather than emitted as `null`,
 * and `bomRef` becomes the specification's hyphenated `bom-ref`.
 */
const toJson = (document: SbomDocument, options?: SbomJsonOptions): string =>
	JSON.stringify(documentJson(document), null, options?.space ?? 2);

/**
 * Write a document to `path` as canonical JSON.
 *
 * @remarks
 * The one fallible member. It does not create parent directories — a caller
 * that wants one creates it, so the failure mode stays "the path you gave me
 * is not writable" rather than "something was created somewhere".
 */
const write = Effect.fn("Sbom.write")(function* (document: SbomDocument, path: string, options?: SbomJsonOptions) {
	const fs = yield* FileSystem.FileSystem;
	yield* fs
		.writeFileString(path, toJson(document, options))
		.pipe(Effect.mapError((cause) => new SbomWriteError({ path, cause })));
});

/**
 * The SBOM emitter: assemble, serialize, write.
 *
 * @example
 * ```ts
 * import { Sbom } from "@effected/sbom";
 *
 * const document = Sbom.generate({ root, components });
 * const json = Sbom.toJson(document);
 * ```
 *
 * @public
 */
export const Sbom = { generate, toJson, write } as const;
