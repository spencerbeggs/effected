"use strict";
// TEMPORARY post-advance bootstrap (effect 4.0.0-beta.101 -> beta.107).
//
// The registry-published @effected/* artifacts and the @savvy-web toolchain
// were built against effect@4.0.0-beta.101 (the toolchain even hard-pins
// @effect/platform-node@4.0.0-beta.101, which drags a real effect@beta.101
// copy into its sub-graph). beta.105 removed Schema.TaggedErrorClass, so a
// graph that injects beta.105 into those peers crashes at import time, and a
// tree holding both betas mixes two effect copies whose Schema issues are not
// interchangeable (SchemaIssue formatting crashes cross-copy).
//
// This hook retargets every Effect-v4-beta spec — `effect` itself and the
// beta-pinned @effect/* satellites — to the workspace pin so the whole tree
// binds ONE effect copy; the paired patches/ shims keep the beta.101-built
// artifacts loadable under it (Schema.TaggedErrorClass ?? Schema.TaggedError).
//
// DELETE this file, patchedDependencies and the effect override in
// pnpm-workspace.yaml once the @savvy-web toolchain republishes against the
// current beta (the documented repair for post-advance stranding).
const EFFECT_PIN = "4.0.0-beta.107";
const V4_BETA = /^4\.0\.0-beta\.\d+$/;

function retarget(deps) {
	if (!deps) return;
	for (const [name, spec] of Object.entries(deps)) {
		if (typeof spec !== "string" || !V4_BETA.test(spec) || spec === EFFECT_PIN) continue;
		if (name === "effect" || name.startsWith("@effect/")) {
			deps[name] = EFFECT_PIN;
		}
	}
}

function readPackage(pkg) {
	retarget(pkg.dependencies);
	retarget(pkg.optionalDependencies);
	retarget(pkg.peerDependencies);
	return pkg;
}

module.exports = { hooks: { readPackage } };
