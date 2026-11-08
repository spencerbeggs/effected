/**
 * The one seam over core `effect/encoding/Xml`.
 *
 * Core's module is `@stability experimental`, so every use of it in this package
 * goes through here, and this file is what to re-verify when the installed
 * `effect` moves.
 *
 * @internal
 */
import { Effect, Stream } from "effect";
import { Xml } from "effect/encoding";

/**
 * The decoder limits.
 *
 * @remarks
 * A ListObjectsV2 page nests four levels (`ListBucketResult` → `Contents` →
 * `Owner` → `ID`) and an `<Error>` document two, so a depth of 32 is wide margin
 * and still refuses a nesting bomb long before it costs anything. The longest
 * token S3 sends is a key (1024 UTF-8 bytes, escaped) or a continuation token, so
 * 1 MiB per token is generous. One page is at most 1000 entries of a few hundred
 * characters each beside their keys; 8 MiB bounds the whole collected tree.
 *
 * @internal
 */
export const XML_LIMITS = {
	maxDepth: 32,
	maxTokenSize: 1024 * 1024,
	maxElementSize: 8 * 1024 * 1024,
} as const;

/**
 * Decode one UTF-8 XML document into its root element's tree.
 *
 * @remarks
 * Core checks well-formedness, decodes the five predefined entities and every
 * character reference (refusing one past `U+10FFFF`), refuses any entity a
 * DOCTYPE declares and never reads an external resource. An empty body, text that
 * is not XML, two roots, or a document past {@link XML_LIMITS} fails with core's
 * `XmlError`, which the client turns into `S3MalformedResponse`.
 *
 * @internal
 */
export const decodeDocument = (bytes: Uint8Array): Effect.Effect<Xml.Element, Xml.XmlError> =>
	Stream.make(bytes).pipe(
		Stream.pipeThroughChannel(Xml.decode({ maxDepth: XML_LIMITS.maxDepth, maxTokenSize: XML_LIMITS.maxTokenSize })),
		// "*" matches the root, whatever its name, so the whole document is one tree.
		Stream.pipeThroughChannel(Xml.elements(["*"], { maxElementSize: XML_LIMITS.maxElementSize })),
		Stream.runCollect,
		Effect.flatMap((roots) => {
			const root = roots[0];
			return root === undefined
				? Effect.fail(new Xml.XmlError({ kind: "Syntax", message: "no root element" }))
				: Effect.succeed(root);
		}),
	);
