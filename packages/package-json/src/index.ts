/**
 * package.json parsing, editing, validation and file IO as Effect schemas.
 *
 * The {@link Package} class is the schema: typed known fields plus a `rest`
 * catch-all for round-trip fidelity, computed getters, dual-signature mutation
 * statics, and {@link Package.resolve} over the `@effected/npm` resolver
 * contracts. Leaf concepts (`PackageName`, `DependencySpecifier`,
 * `SpdxLicense`, {@link PackageManager}, {@link Person},
 * {@link DevEngine}, {@link Dependency}) carry their own statics and errors.
 * {@link PackageJsonFile} is the only IO surface, over core `FileSystem` /
 * `Path`; {@link PackageValidator} runs rule-based validation.
 *
 * @packageDocumentation
 */

export {
	Dependency,
	type DependencyKind,
	Dependency_base,
	type UnresolvedDependency,
	isUnresolvedDependency,
} from "./Dependency.js";
export {
	type DependencyProtocol,
	DependencySpecifier,
	type DependencySpecifierBrand,
	InvalidDependencySpecifierError,
	InvalidDependencySpecifierError_base,
	isValidDependencySpecifier,
} from "./DependencySpecifier.js";
export { DevEngine, DevEngineOrArray, DevEngine_base, type DevEngines, DevEnginesSchema } from "./DevEngines.js";
export { InvalidSpdxLicenseError, InvalidSpdxLicenseError_base, SpdxLicense, isValidSpdx } from "./License.js";
export {
	BinField,
	DependencyMapField,
	ExportsField,
	Package,
	PackageDecodeError,
	PackageDecodeError_base,
	type PackageFormatOptions,
	type PackagePatch,
	Package_base,
	PeerDependenciesMetaField,
	PublishConfigField,
	RepositoryField,
	StringMapField,
} from "./Package.js";
export {
	PackageJsonFile,
	type PackageJsonFileShape,
	PackageJsonFile_base,
	PackageJsonNotFoundError,
	PackageJsonNotFoundError_base,
	PackageJsonParseError,
	PackageJsonParseError_base,
	PackageJsonReadError,
	PackageJsonReadError_base,
	PackageJsonWriteError,
	PackageJsonWriteError_base,
} from "./PackageJsonFile.js";
export { PackageManager, PackageManager_base } from "./PackageManager.js";
export {
	InvalidPackageNameError,
	InvalidPackageNameError_base,
	PackageName,
	ScopedPackageName,
	UnscopedPackageName,
} from "./PackageName.js";
export {
	PackageValidationError,
	PackageValidationError_base,
	PackageValidator,
	PackageValidator_base,
	type RuleFailure,
	type ValidationRule,
	defaultRules,
	noLocalDepsRule,
	noUnresolvedDepsRule,
} from "./PackageValidator.js";
export { Person, Person_base } from "./Person.js";
