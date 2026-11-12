import { assert, describe, it } from "@effect/vitest";
import { renderThirdPartyLicenses } from "../../src/passes/third-party-licenses.js";

describe("renderThirdPartyLicenses", () => {
	it("lists each package sorted by name, with its licence and the text of its notice files", () => {
		const text = renderThirdPartyLicenses("@x/tool", [
			{ name: "b", version: "1.0.0", license: "ISC", notices: [] },
			{ name: "a", version: "2.0.0", license: "MIT", notices: [{ file: "LICENSE", text: "MIT text\n\n" }] },
		]);
		assert.isTrue(text.startsWith("@x/tool includes code from the following packages"));
		assert.isBelow(text.indexOf("a@2.0.0"), text.indexOf("b@1.0.0"));
		assert.include(text, "a@2.0.0\nLicense: MIT\n\nLICENSE:\n\nMIT text\n");
		assert.include(text, "b@1.0.0\nLicense: ISC\n\n(no licence file is shipped with this package)");
	});
});
