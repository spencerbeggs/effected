// packages/bundler/src/dts/parse.ts
import type { SourceFile } from "typescript/ast";
import { ScriptKind } from "typescript/ast";
import { API } from "typescript/sync";

/**
 * One lazily-started TypeScript API client for this process. TypeScript 7.1's compiler API lives
 * behind a Go server, so every parse goes through a client; constructing one per call would spawn
 * a process per file. An un-closed client does not hold the Node process open, so the singleton is
 * never explicitly closed — it dies with the process.
 */
let client: API | undefined;

/**
 * Parse `source` as a TypeScript module and hand its syntax tree to `use`, releasing the server-side
 * retention afterwards. Pure parsing — no I/O, no type information. The tree must not escape `use`.
 *
 * @internal
 */
export function withParsedSource<T>(fileName: string, source: string, use: (sf: SourceFile) => T): T {
	client ??= new API();
	const retained = client.createSourceFile(fileName, source, { scriptKind: ScriptKind.TS });
	try {
		return use(retained.sourceFile);
	} finally {
		retained.dispose();
	}
}
