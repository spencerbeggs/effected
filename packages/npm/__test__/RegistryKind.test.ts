import { assert, describe, it } from "@effect/vitest";
import { classifyRegistry } from "../src/RegistryKind.js";

describe("classifyRegistry", () => {
	it("classifies the public npm registry, with or without a scheme or path", () => {
		assert.strictEqual(classifyRegistry("https://registry.npmjs.org"), "npm");
		assert.strictEqual(classifyRegistry("https://registry.npmjs.org/"), "npm");
		assert.strictEqual(classifyRegistry("registry.npmjs.org/"), "npm");
		assert.strictEqual(classifyRegistry("https://npmjs.org"), "npm");
	});

	it("classifies GitHub Packages and JSR", () => {
		assert.strictEqual(classifyRegistry("https://npm.pkg.github.com"), "github-packages");
		assert.strictEqual(classifyRegistry("https://jsr.io"), "jsr");
	});

	it("classifies anything else as custom", () => {
		assert.strictEqual(classifyRegistry("https://artifactory.example.com/api/npm/repo"), "custom");
		assert.strictEqual(classifyRegistry("https://verdaccio.internal:4873"), "custom");
	});

	it("treats an absent registry as npm — no registry configured means the default", () => {
		assert.strictEqual(classifyRegistry(undefined), "npm");
		assert.strictEqual(classifyRegistry(""), "npm");
	});

	it("does NOT match a lookalike domain", () => {
		// A bare `endsWith("npmjs.org")` would classify these as the public npm
		// registry, and that classification decides whether provenance is
		// requested and which auth path runs. The leading dot is the guard.
		assert.strictEqual(classifyRegistry("https://evil-npmjs.org"), "custom");
		assert.strictEqual(classifyRegistry("https://notnpmjs.org/"), "custom");
		assert.strictEqual(classifyRegistry("https://npmjs.org.attacker.test"), "custom");
	});

	it("matches genuine subdomains", () => {
		assert.strictEqual(classifyRegistry("https://registry.npmjs.org"), "npm");
		assert.strictEqual(classifyRegistry("https://mirror.jsr.io"), "jsr");
	});

	it("is case-insensitive on the host", () => {
		assert.strictEqual(classifyRegistry("https://REGISTRY.NPMJS.ORG"), "npm");
	});

	it("classifies an unparseable value as custom rather than throwing", () => {
		assert.strictEqual(classifyRegistry("::::"), "custom");
	});
});
