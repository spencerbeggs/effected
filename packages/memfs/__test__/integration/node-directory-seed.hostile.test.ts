// How NodeDirectorySeed.read's mountAt trim grows with a long run of slashes. `node-directory-seed.int.test.ts`
// holds what it answers.
//
// The hostile tier runs this file alone, as a growth ratio needs (#1387). This package takes no `@effected`
// dependency of any kind, `@effected/testing` included, so the measurement `Growth` would make is written out here,
// and `__test__/test-kinds.test.ts` exempts this file from reaching `Growth` (#1420).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { NodeDirectorySeed } from "../../src/NodeSyncFileSystem.js";

/**
 * Milliseconds of CPU time this process has spent (`process.cpuUsage`, user plus system): time the work spent, not
 * time the process was descheduled, so a loaded machine can not stretch a sample. The hostile tier runs each file in
 * its own fork, one at a time, so no other test's CPU lands here.
 */
const cpuNow = (): number => {
	const used = process.cpuUsage();
	return (used.user + used.system) / 1000;
};

let empty: string;
beforeAll(() => {
	empty = mkdtempSync(join(tmpdir(), "memfs-seed-growth-"));
});
afterAll(() => {
	rmSync(empty, { recursive: true, force: true });
});

describe("NodeDirectorySeed.read on a long run of slashes in mountAt", () => {
	it("trims the run in time linear in its length", () => {
		// A run of slashes that is not trailing: an end-anchored `/\/+$/` rescans the run from every start position.
		const mount = (run: number): string => `/${"/".repeat(run)}m`;
		// A ratio, not a time: four times the run against the run, each the fastest of five. The linear trim reads
		// about 1x here, since reading the directory outweighs it, and the quadratic one about 16x.
		const fastest = (mountAt: string): number => {
			let best = Number.POSITIVE_INFINITY;
			for (let sample = 0; sample < 5; sample += 1) {
				const start = cpuNow();
				NodeDirectorySeed.read(empty, { mountAt });
				best = Math.min(best, cpuNow() - start);
			}
			return best;
		};
		fastest(mount(1 << 10));
		const small = fastest(mount(1 << 14));
		const large = fastest(mount(1 << 16));
		assert.isBelow(large / Math.max(small, 0.05), 10, `${small.toFixed(3)} ms -> ${large.toFixed(3)} ms`);
	});
});
