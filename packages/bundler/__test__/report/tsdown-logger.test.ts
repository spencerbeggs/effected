import { assert, describe, it } from "@effect/vitest";
import { BuildCollector } from "../../src/report/collector.js";
import { createTsdownLogger } from "../../src/report/tsdown-logger.js";

describe("createTsdownLogger", () => {
	it("routes warn/error into the collector and ignores info/success", () => {
		const c = new BuildCollector();
		c.registerGroup("npm", []);
		const log = createTsdownLogger(c, "npm");
		log.info("entry:", "\x1b[34msrc/index.ts\x1b[39m");
		log.success("Build complete");
		log.warn("circular dependency");
		log.error("oops");
		const [report] = c.snapshot("@x/p");
		const g = report?.targetGroups[0];
		assert.strictEqual(g?.warnings.length, 1);
		assert.strictEqual(g?.warnings[0]?.text, "circular dependency");
		assert.strictEqual(g?.warnings[0]?.source, "tsdown");
		assert.strictEqual(g?.errors[0]?.text, "oops");
	});

	it("strips ANSI escape codes from captured text", () => {
		const c = new BuildCollector();
		const log = createTsdownLogger(c, "npm");
		log.warn("\x1b[33mheads up\x1b[39m");
		const [report] = c.snapshot("@x/p");
		assert.strictEqual(report?.targetGroups[0]?.warnings[0]?.text, "heads up");
	});

	it("dedupes warnOnce by text", () => {
		const c = new BuildCollector();
		const log = createTsdownLogger(c, "npm");
		log.warnOnce("same");
		log.warnOnce("same");
		const [report] = c.snapshot("@x/p");
		assert.strictEqual(report?.targetGroups[0]?.warnings.length, 1);
	});
});
