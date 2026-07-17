/**
 * package.json parsing, editing, validation and file IO as Effect schemas.
 *
 * The {@link Package} class is the schema: typed known fields plus a `rest`
 * catch-all for round-trip fidelity, computed getters, dual-signature mutation
 * statics, and {@link Package.resolve} over the `@effected/npm` resolver
 * contracts. Leaf concepts (`PackageName`, `DependencySpecifier`,
 * `SpdxLicense`, {@link PackageManager}, {@link Person}, {@link DevEngine},
 * {@link Dependency}) carry their own statics and errors and compose into
 * `Package`'s fields. {@link PackageJsonFile} is the only IO surface, over
 * core `FileSystem` / `Path`; {@link PackageValidator} runs rule-based
 * validation over a decoded `Package`.
 *
 * @packageDocumentation
 */

export {
	type DependencyKind,
	type DependencyProtocol,
	DependencySpecifier,
	type DependencySpecifierBrand,
	InvalidDependencySpecifierError,
	isValidDependencySpecifier,
} from "@effected/npm";
export { Dependency, type UnresolvedDependency, isUnresolvedDependency } from "./Dependency.js";
export { DevEngine, DevEngineOrArray, type DevEngines, DevEnginesSchema } from "./DevEngines.js";
export { InvalidSpdxLicenseError, SpdxLicense, isValidSpdx } from "./License.js";
export {
	BinField,
	DependencyMapField,
	ExportsField,
	Package,
	PackageDecodeError,
	type PackageFormatOptions,
	type PackageIndent,
	type PackagePatch,
	PeerDependenciesMetaField,
	PublishConfigField,
	RepositoryField,
	StringMapField,
} from "./Package.js";
export {
	PackageJsonFile,
	type PackageJsonFileShape,
	PackageJsonNotFoundError,
	PackageJsonParseError,
	PackageJsonReadError,
	PackageJsonWriteError,
} from "./PackageJsonFile.js";
export { PackageManager } from "./PackageManager.js";
export {
	InvalidPackageNameError,
	PackageName,
	ScopedPackageName,
	UnscopedPackageName,
} from "./PackageName.js";
export {
	PackageValidationError,
	PackageValidator,
	type RuleFailure,
	type ValidationRule,
	defaultRules,
	noLocalDepsRule,
	noUnresolvedDepsRule,
} from "./PackageValidator.js";
export { Person } from "./Person.js";
