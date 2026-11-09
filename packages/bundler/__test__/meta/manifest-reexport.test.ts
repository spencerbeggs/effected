import { assert, it } from "@effect/vitest";
import * as BundleManifestPackage from "@effected/manifest";
import * as BundlerPackage from "../../src/index.js";

// The schema moved to @effected/manifest; the bundler's root keeps every name, as the SAME value, so a
// bundler consumer sees no change and a manifest decoded through one entry is the schema the other encodes.
it("re-exports every @effected/manifest value from the bundler root, as the same value", () => {
	const names = Object.keys(BundleManifestPackage).sort();
	// positive control: the package exports the schema at all
	assert.include(names, "BundleManifest");
	for (const name of names) {
		assert.strictEqual(
			(BundlerPackage as Record<string, unknown>)[name],
			(BundleManifestPackage as Record<string, unknown>)[name],
			`@effected/bundler re-exports ${name} as a different value`,
		);
	}
});
