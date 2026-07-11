// Multi-document pnpm lockfiles.
//
// pnpm 11 writes `pnpm-lock.yaml` as TWO YAML documents when the workspace uses
// `configDependencies`: a small lockfile for the config dependencies themselves,
// then the real lockfile. This repo's own lockfile is exactly that shape.
//
// `@effected/lockfiles` is pure and its entrypoint takes one document's text, so
// deciding WHICH document in a file is the lockfile is a framing question — the
// same kind of question as deciding which filename to read — and it belongs to
// the layer that reads the file. That is here.
//
// Splitting on the document marker rather than re-serializing a parsed tree is
// deliberate: the pure parser must receive the author's bytes, not a
// round-tripped approximation of them.

/** A YAML document start marker: `---` alone on its own line, optionally with trailing spaces. */
const DOCUMENT_MARKER = /^---[ \t]*$/;

/**
 * Split YAML text into its documents, each as verbatim source text.
 *
 * A single-document file (no marker, or one leading marker) yields exactly one
 * chunk, so the common case costs one scan and changes nothing.
 */
export const documentsOf = (text: string): ReadonlyArray<string> => {
	const lines = text.split("\n");
	const documents: Array<Array<string>> = [];
	let current: Array<string> = [];

	for (const line of lines) {
		if (DOCUMENT_MARKER.test(line)) {
			if (current.length > 0) documents.push(current);
			current = [];
			continue;
		}
		current.push(line);
	}
	if (current.length > 0) documents.push(current);

	const chunks = documents.map((document) => document.join("\n")).filter((chunk) => chunk.trim().length > 0);
	return chunks.length === 0 ? [text] : chunks;
};
