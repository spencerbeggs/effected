import changelogGit from "@changesets/changelog-git";
import type * as Theirs from "@changesets/types";
import { assert, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Ours from "../src/Changelog.js";

/**
 * `true` only when each type is assignable to the other. `tsc --noEmit`
 * (`types:check`) compiles this file, so a `false` assigned to `true` below
 * fails the type check, not the run.
 */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const identical: {
	readonly [K in
		| "ChangelogFunctions"
		| "GetReleaseLine"
		| "GetDependencyReleaseLine"
		| "NewChangeset"
		| "NewChangesetWithCommit"
		| "ModCompWithPackage"
		| "ComprehensiveRelease"
		| "PackageJSON"
		| "VersionType"]: true;
} = {
	ChangelogFunctions: true satisfies Mutual<Ours.ChangelogFunctions, Theirs.ChangelogFunctions>,
	GetReleaseLine: true satisfies Mutual<Ours.GetReleaseLine, Theirs.GetReleaseLine>,
	GetDependencyReleaseLine: true satisfies Mutual<Ours.GetDependencyReleaseLine, Theirs.GetDependencyReleaseLine>,
	NewChangeset: true satisfies Mutual<Ours.NewChangeset, Theirs.NewChangeset>,
	NewChangesetWithCommit: true satisfies Mutual<Ours.NewChangesetWithCommit, Theirs.NewChangesetWithCommit>,
	ModCompWithPackage: true satisfies Mutual<Ours.ModCompWithPackage, Theirs.ModCompWithPackage>,
	ComprehensiveRelease: true satisfies Mutual<Ours.ComprehensiveRelease, Theirs.ComprehensiveRelease>,
	PackageJSON: true satisfies Mutual<Ours.PackageJSON, Theirs.PackageJSON>,
	VersionType: true satisfies Mutual<Ours.VersionType, Theirs.VersionType>,
};

/** `true` when a value of `T` can be passed where `Record<string, unknown>` is expected. */
type Indexable<T> = [T] extends [Record<string, unknown>] ? true : false;

/**
 * `true` unless theirs is indexable and ours is not. An interface gets no
 * implicit index signature, so a module that hands one of these values to a
 * `Record<string, unknown>` parameter would stop compiling on the switch,
 * though `Mutual` still answers `true`. Ours may be indexable where theirs is
 * not (`ComprehensiveRelease` unions interfaces there), which breaks nobody.
 */
type AtLeastAsIndexable<Ours, Theirs> = Indexable<Theirs> extends true ? Indexable<Ours> : true;

const indexable: {
	readonly [K in
		| "ChangelogFunctions"
		| "NewChangeset"
		| "NewChangesetWithCommit"
		| "ModCompWithPackage"
		| "ComprehensiveRelease"
		| "PackageJSON"]: true;
} = {
	ChangelogFunctions: true satisfies AtLeastAsIndexable<Ours.ChangelogFunctions, Theirs.ChangelogFunctions>,
	NewChangeset: true satisfies AtLeastAsIndexable<Ours.NewChangeset, Theirs.NewChangeset>,
	NewChangesetWithCommit: true satisfies AtLeastAsIndexable<Ours.NewChangesetWithCommit, Theirs.NewChangesetWithCommit>,
	ModCompWithPackage: true satisfies AtLeastAsIndexable<Ours.ModCompWithPackage, Theirs.ModCompWithPackage>,
	ComprehensiveRelease: true satisfies AtLeastAsIndexable<Ours.ComprehensiveRelease, Theirs.ComprehensiveRelease>,
	PackageJSON: true satisfies AtLeastAsIndexable<Ours.PackageJSON, Theirs.PackageJSON>,
};

// Theirs: the type aliases are indexable, so ours must be too.
const theirsIndexable = [
	true satisfies Indexable<Theirs.PackageJSON>,
	true satisfies Indexable<Theirs.NewChangeset>,
	true satisfies Indexable<Theirs.ChangelogFunctions>,
] as const;

// Ours: every schema-derived data type is indexable, theirs or not.
const oursIndexable = [
	true satisfies Indexable<Ours.PackageJSON>,
	true satisfies Indexable<Ours.NewChangeset>,
	true satisfies Indexable<Ours.NewChangesetWithCommit>,
	true satisfies Indexable<Ours.ComprehensiveRelease>,
	true satisfies Indexable<Ours.ModCompWithPackage>,
	true satisfies Indexable<Ours.ChangelogFunctions>,
] as const;

// The readonly control: the same shape from a plain Schema.Struct and
// Schema.Array is readonly, and a ReadonlyArray is not assignable to
// theirs' string[], so dropping a mutableKey or mutable fails Mutual.
const ReadonlyChangeset = Schema.Struct({
	summary: Schema.String,
	releases: Schema.Array(Schema.Struct({ name: Schema.String, type: Ours.VersionType })),
	id: Schema.String,
});
const readonlyControl = false satisfies Mutual<typeof ReadonlyChangeset.Type, Theirs.NewChangeset>;

// The indexability control: PackageJSON written as an interface is not
// indexable, so a shape that became one fails the check above.
interface PackageJSONAsInterface {
	name: string;
	version: string;
}
const interfaceControl = false satisfies AtLeastAsIndexable<PackageJSONAsInterface, Theirs.PackageJSON>;

// The control: the helper answers false for types that differ in one field's
// optionality, so the checks above are not vacuous.
const control = false satisfies Mutual<
	Ours.NewChangesetWithCommit,
	Omit<Theirs.NewChangesetWithCommit, "commit"> & { commit: string }
>;

it("the ChangelogFunctions contract is @changesets/types' both ways", () => {
	assert.isTrue(Object.values(identical).every(Boolean));
	assert.isFalse(control);
	assert.isTrue(Object.values(indexable).every(Boolean));
	assert.isTrue(theirsIndexable.every(Boolean));
	assert.isFalse(interfaceControl);
	assert.isTrue(oursIndexable.every(Boolean));
	assert.isFalse(readonlyControl);
	// Each value is accepted where a record is expected, as theirs is.
	const pkg: Ours.PackageJSON = { name: "a", version: "1.0.0" };
	const asRecord: Record<string, unknown> = pkg;
	assert.strictEqual(asRecord.name, "a");
	// A module written against either loads as the other.
	const ours: Ours.ChangelogFunctions = changelogGit;
	const theirs: Theirs.ChangelogFunctions = ours;
	assert.strictEqual(theirs, changelogGit);
});
