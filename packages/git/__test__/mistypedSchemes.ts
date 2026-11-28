// Credential URL prefixes whose scheme separator is mistyped, so the value parses as a transport, scp or path form
// rather than a URL. `GitCommand.test.ts` masks a credential behind each, and `GitCommand.property.test.ts` mixes
// them into generated values.

/** Each mistyped prefix, the empty one included. */
export const MISTYPED_PREFIXES: ReadonlyArray<string> = [
	"https:://",
	"https:/",
	"//",
	"https:",
	"https:///",
	"git+https:://",
	"persistent::https:/",
	"persistent:://",
	"ssh:/",
	"http:\\\\",
	"https//",
	":",
	"",
];
