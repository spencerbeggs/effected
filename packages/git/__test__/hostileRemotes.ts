// Remote strings built to make a parser's scans meet their worst case, each sized by a count. `GitRemote.test.ts`
// parses them for what comes back, and `GitRemote.hostile.test.ts` for how the parse grows.

/** Each shape by name. `make(count)` repeats its unit `count` times; the count is a multiple of 8. */
export const HOSTILE_REMOTES: ReadonlyArray<readonly [label: string, make: (count: number) => string]> = [
	["unmatched [", (count) => "[".repeat(count)],
	["unmatched [ then :", (count) => `${"[".repeat(count)}:x`],
	["bracket pairs", (count) => "[]".repeat(count)],
	["@[ runs", (count) => "@[".repeat(count)],
	["@[ runs then :", (count) => `${"@[".repeat(count)}:x`],
	["many @", (count) => `https://${"@".repeat(count)}h/x`],
	["many :", (count) => ":".repeat(count)],
	["many ::", (count) => `a${"::".repeat(count)}`],
	["scheme-like run then ::", (count) => `${"a".repeat(count)}::x`],
	["scheme-like run then ://", (count) => `${"a".repeat(count)}://`],
	["scheme-like run, nothing after", (count) => "a".repeat(count)],
	["many ://", (count) => "://".repeat(count)],
	["many /", (count) => "/".repeat(count)],
	["NUL and C0", (count) => "\0\u0001\u001b:\u0007/".repeat(count / 8)],
];
