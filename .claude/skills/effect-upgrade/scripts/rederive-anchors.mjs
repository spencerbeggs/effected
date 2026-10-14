// Re-derive skill source anchors after .repos/effect moves.
// For each anchor in plugin/__test__/helpers/skill-anchors.json whose symbols no
// longer sit on their cited lines, find the nearest line carrying the FIRST
// symbol, shift every cited line by that offset, and (with --write) rewrite the
// manifest entry and the anchor token in its skill file. Prints "STILL BAD" and
// leaves an entry alone when the shifted lines do not all match: the cited block
// changed shape and needs a human read. Run from the repo root:
//   node .claude/skills/effect-upgrade/scripts/rederive-anchors.mjs [--write]
// Bare `:N` prose mentions are not in the manifest; grep them by hand.
import { readFileSync, writeFileSync } from "node:fs";

const repo = process.cwd();
const mPath = `${repo}/plugin/__test__/helpers/skill-anchors.json`;
const m = JSON.parse(readFileSync(mPath, "utf8"));
const roots = { effect: ".repos/effect/packages/effect/src", vitest: ".repos/effect/packages/vitest/src", repo: "." };
const apply = process.argv.includes("--write");
const skillEdits = new Map();
for (const a of m.anchors) {
	const [root, p] = a.source.split(/:(.*)/s);
	const lines = readFileSync(`${repo}/${roots[root]}/${p}`, "utf8").split("\n");
	const keys = Object.keys(a.symbols)
		.map(Number)
		.sort((x, y) => x - y);
	const ok = keys.every((k) => (lines[k - 1] ?? "").includes(a.symbols[k]));
	if (ok) continue;
	// offset from the first key's (most specific) symbol: nearest occurrence
	const first = keys[0];
	const cands = lines.flatMap((l, i) => (l.includes(a.symbols[first]) ? [i + 1] : []));
	if (cands.length === 0) {
		console.log("MISSING", a.file, a.anchor, a.symbols[first]);
		continue;
	}
	const nl = cands.reduce((b, c) => (Math.abs(c - first) < Math.abs(b - first) ? c : b));
	const off = nl - first;
	const newSymbols = Object.fromEntries(keys.map((k) => [String(k + off), a.symbols[k]]));
	const bad = keys.filter((k) => !(lines[k + off - 1] ?? "").includes(a.symbols[k]));
	const newAnchor = a.anchor.replace(/(:|,|-|–)(\d+)/g, (_, s, n) => s + (Number(n) + off));
	console.log(
		`${a.file}: ${a.anchor} -> ${newAnchor} (off ${off}, cands ${cands.length})${bad.length ? " STILL BAD " + bad : ""}`,
	);
	if (apply && !bad.length) {
		a.symbols = newSymbols;
		const list = skillEdits.get(a.file) ?? [];
		list.push([a.anchor, newAnchor]);
		skillEdits.set(a.file, list);
		a.anchor = newAnchor;
	}
}
if (apply) {
	writeFileSync(mPath, JSON.stringify(m, null, "\t") + "\n");
	for (const [f, edits] of skillEdits) {
		const path = `${repo}/plugin/skills/${f}`;
		let t = readFileSync(path, "utf8");
		for (const [o, n] of [...new Map(edits)]) {
			const re = new RegExp(o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![0-9])", "g");
			const c = (t.match(re) || []).length;
			t = t.replace(re, n);
			console.log("edit", f, o, "->", n, "x" + c);
		}
		writeFileSync(path, t);
	}
}
