// How GitRemote.parse grows on hostile input. `GitRemote.test.ts` holds that each shape returns.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { GitRemote } from "../src/GitRemote.js";
import { HOSTILE_REMOTES } from "./hostileRemotes.js";

describe("GitRemote hardening — hostile input stays linear", () => {
	// Linear is about 4x from 16,000 to 64,000; quadratic would be about 16x. The bracket runs meet git's
	// host_end search, the scheme-character runs its transport probe, and the `@` runs the userinfo split.
	for (const [label, make] of HOSTILE_REMOTES) {
		it(`${label}: parses in time linear in its length`, () => {
			Growth.assertOrder(
				(count) => {
					const raw = make(count);
					return () => GitRemote.parse(raw);
				},
				{ from: 16_000, order: 1 },
			);
		});
	}
});
