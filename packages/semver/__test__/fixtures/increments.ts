/** [initial, operation, expected] */
export const incrementTests: ReadonlyArray<[string, "major" | "minor" | "patch", string]> = [
	["0.0.0", "major", "1.0.0"],
	["0.0.0", "minor", "0.1.0"],
	["0.0.0", "patch", "0.0.1"],
	["1.2.3", "major", "2.0.0"],
	["1.2.3", "minor", "1.3.0"],
	["1.2.3", "patch", "1.2.4"],
	["1.0.0-alpha", "major", "2.0.0"],
	["1.0.0-alpha", "minor", "1.1.0"],
	["1.0.0-alpha", "patch", "1.0.1"],
	["0.9.9", "major", "1.0.0"],
	["0.9.9", "minor", "0.10.0"],
	["0.9.9", "patch", "0.9.10"],
];
