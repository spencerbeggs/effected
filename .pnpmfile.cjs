// Effect 4.1 bridge: the build toolchain (@savvy-web/*, okfit, tsdoctor,
// vitest-agent, pluginfinity, rolldown-pnpm-config) loads the published
// @effected/* closure, which was built on effect 4.0.7 and imports `Crypto`
// from the effect root, an export 4.1.0 removed. The catalog's derived override
// pins every `effect` in the graph to 4.1.1, so those published copies would
// bind it and die at import.
//
// Run each bridged package on the old effect: its `effect` (peer or dependency)
// and every `@effect/*` it names become regular dependencies on npm aliases of
// the old release. The alias is not matched by the version-selector override.
// The tools themselves are bridged too, not only the kit they load: a tool on
// 4.1.1 handing values to a kit on 4.0.7 runs two Effect copies and crashes
// (okfit: `Cannot convert a Symbol value to a string`).
//
// The `private` check leaves this workspace's own packages (identical versions
// until the release bumps them) untouched.
//
// Remove once the toolchain republishes against an @effected/* release built on
// effect 4.1: then no lockfile `packages:` entry names effect@4.0.7.
const BRIDGED = "4.0.7";

// Toolchain families that reach the published kit, some only transitively
// (silk through silk-effects), so a direct-dependency check alone misses them.
const TOOLCHAIN = [
	"@okfit/",
	"@pluginfinity/",
	"@savvy-web/",
	"@tsdoctor/",
	"@vitest-agent/",
	"pluginfinity",
	"rolldown-pnpm-config",
	"rspress-plugin-api-extractor",
];

// Only members on effect's own 4.x line: `@effect/tsgo` and
// `@effect/language-service` version separately and have no 4.0.7.
const isEffectLine = (name, spec) =>
	(name === "effect" || name.startsWith("@effect/")) && /^[\^~=]*4\./.test(String(spec).trim());

const reachesKit = (pkg) =>
	[pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies].some((deps) =>
		Object.keys(deps ?? {}).some((name) => name.startsWith("@effected/")),
	);

// A bridged satellite's own `@effect/*` dependencies (platform-node on
// platform-node-shared) would otherwise meet the override and land on 4.1.1
// bound to the old effect, which then fails to import.
const isBridgedSatellite = (pkg) => pkg.version === BRIDGED && isEffectLine(pkg.name, pkg.version);

const isBridged = (pkg) =>
	isBridgedSatellite(pkg) ||
	pkg.name?.startsWith("@effected/") ||
	TOOLCHAIN.some((prefix) => pkg.name === prefix || pkg.name?.startsWith(prefix)) ||
	reachesKit(pkg);

function readPackage(pkg) {
	if (pkg.private === true || !pkg.name || !isBridged(pkg)) return pkg;
	const pinned = {};
	for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
		for (const name of Object.keys(pkg[field] ?? {})) {
			if (!isEffectLine(name, pkg[field][name])) continue;
			delete pkg[field][name];
			pinned[name] = `npm:${name}@${BRIDGED}`;
		}
	}
	if (Object.keys(pinned).length > 0) pkg.dependencies = { ...pkg.dependencies, ...pinned };
	return pkg;
}

module.exports = { hooks: { readPackage } };
