import { assert, describe, it } from "@effect/vitest";
import type { DriftTolerance, WriteChange } from "../src/index.js";
import { DriftPolicy } from "../src/index.js";

const changes: ReadonlyArray<WriteChange> = ["none", "created", "annotations", "contract"];
const policies: ReadonlyArray<DriftTolerance> = ["strict", "semantic", "allow"];

describe("DriftPolicy.classify", () => {
	it("never reports drift on an unpublished target", () => {
		for (const policy of policies) {
			for (const change of changes) {
				assert.strictEqual(DriftPolicy.classify({ published: false, change }, policy), "write", `${policy}/${change}`);
			}
		}
	});

	it("allow writes everything on a published target", () => {
		for (const change of changes) {
			assert.strictEqual(DriftPolicy.classify({ published: true, change }, "allow"), "write", change);
		}
	});

	it("semantic drifts only on a contract change", () => {
		assert.strictEqual(DriftPolicy.classify({ published: true, change: "contract" }, "semantic"), "drift");
		assert.strictEqual(DriftPolicy.classify({ published: true, change: "annotations" }, "semantic"), "write");
		assert.strictEqual(DriftPolicy.classify({ published: true, change: "none" }, "semantic"), "write");
		assert.strictEqual(DriftPolicy.classify({ published: true, change: "created" }, "semantic"), "write");
	});

	it("strict drifts on annotations too, but not on none or created", () => {
		assert.strictEqual(DriftPolicy.classify({ published: true, change: "contract" }, "strict"), "drift");
		assert.strictEqual(DriftPolicy.classify({ published: true, change: "annotations" }, "strict"), "drift");
		assert.strictEqual(DriftPolicy.classify({ published: true, change: "none" }, "strict"), "write");
		assert.strictEqual(DriftPolicy.classify({ published: true, change: "created" }, "strict"), "write");
	});

	it("defaults to semantic and error", () => {
		assert.deepStrictEqual(DriftPolicy.defaults, { policy: "semantic", onDrift: "error" });
	});
});
