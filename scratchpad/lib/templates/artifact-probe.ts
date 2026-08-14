/**
 * Artifact probe — runs the BUILT prod artifact (dist/prod/npm/pkg) while
 * typing it with the workspace (dev-build) surface, for "does the published
 * artifact behave the same" questions. The double cast through unknown is
 * required: dev and prod declarations of private-field classes are nominally
 * distinct.
 *
 * Build the target first: pnpm build --filter @effected/semver
 * Run from the repo root:  pnpm scratchpad:probe probes/artifact-probe.ts
 * (The relative path below is written for this file's seeded home, probes/.)
 */
import { Effect } from "effect";

const artifact = (await import(
	"../../packages/semver/dist/prod/npm/pkg/index.js"
)) as unknown as typeof import("@effected/semver");

const version = Effect.runSync(artifact.SemVer.parse("2.0.0-rc.1"));
console.log("artifact parsed:", version.major, [...version.prerelease]);
