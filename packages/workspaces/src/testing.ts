/**
 * Repo-shape checks for a monorepo's own test suite: `SourceBoundary` keeps
 * `process`, `node:` imports and console writes out of modules meant to be
 * free of them.
 *
 * @remarks
 * A separate subpath, never re-exported from `.`, so the main entry's
 * consumers never load a scanner, a policy decoder or package-manager
 * orchestration they do not use (the second-published-entrypoint decision).
 *
 * @packageDocumentation
 */

// This module is an ENTRY POINT: api-extractor models it as its own surface,
// so every kit type its signatures name is re-exported here.
export {
	type BoundaryFixture,
	type BoundaryRule,
	Offence,
	type ReferenceOptions,
	type ScanOptions,
	SourceBoundary,
	SourceScan,
} from "./SourceBoundary.js";
