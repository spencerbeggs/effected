import { assert, describe, it } from "@effect/vitest";
import { isCI } from "../src/ci.js";

// `main` answers `ci` with `isCI(process.env)`; these cases pin the rule it
// must follow, `@effected/env`'s one CI rule.
describe("effected CI detection", () => {
	const cases: ReadonlyArray<readonly [string, Record<string, string>, boolean]> = [
		["CI=false is not CI", { CI: "false" }, false],
		["CI=true is CI", { CI: "true" }, true],
		["GITHUB_ACTIONS=true is CI", { GITHUB_ACTIONS: "true" }, true],
		["a JENKINS_URL marker is CI", { JENKINS_URL: "https://jenkins.example/" }, true],
		["an empty environment is not CI", {}, false],
	];
	for (const [name, env, expected] of cases) {
		it(name, () => {
			assert.strictEqual(isCI(env), expected);
		});
	}
});
