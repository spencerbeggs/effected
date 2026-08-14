/**
 * Free-form probe — WORKSPACE mode. Bare @effected imports resolve to each
 * package's dist/dev build (pnpm links workspace deps via publishConfig
 * directory), kept fresh by install prepare hooks and the vitest pre-build.
 * After editing a package's src, rebuild before trusting a tsx probe:
 * pnpm build --filter @effected/<pkg>
 *
 * Run from the repo root: pnpm scratchpad:probe probes/probe.ts
 * This file is disposable — pnpm scratchpad:reset reseeds it.
 */

import { createRequire } from "node:module";
import { SemVer } from "@effected/semver";
import { Effect } from "effect";

// Precondition: print the resolved effect version. A probe that measured the
// wrong version settles nothing.
const require_ = createRequire(import.meta.url);
console.log("effect", (require_("effect/package.json") as { version: string }).version);

const version = Effect.runSync(SemVer.parse("1.2.3-beta.1+build.42"));
console.log(version.major, version.minor, version.patch, [...version.prerelease]);
