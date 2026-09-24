#!/usr/bin/env bats
# skill-anchors.bats — pins every `File.ts:N` source anchor in the in-scope
# skills to the symbol it names.
#
# Skills cite Effect and kit source by line so a reader can open the exact
# declaration. Those lines drift on every Effect advance and every kit edit,
# and a stale anchor reads exactly like a correct one. The check lives in
# helpers/skill-anchors.mjs; its data is helpers/skill-anchors.json, a manifest
# of (skill file, anchor, source, line -> symbol) entries. The helper's header
# says how to add an anchor. In short: add an entry to the JSON with the token
# exactly as the skill writes it and the literal text its cited line must hold.
#
# The positive control runs the real tree. The negative controls prove each
# failure mode can fire: a manifest line pointed off its symbol, a skill whose
# anchor text changed, and a manifest missing an entry. They run on copies in
# BATS_TEST_TMPDIR and never touch the committed tree.

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
REPO_ROOT="$(cd "$PLUGIN_ROOT/../.." && pwd)"
HELPER="$PLUGIN_ROOT/__test__/helpers/skill-anchors.mjs"
MANIFEST="$PLUGIN_ROOT/__test__/helpers/skill-anchors.json"

# _copy_scope dest — copy every in-scope skill path into dest, preserving the
# layout relative to skills/.
_copy_scope() {
	local dest="$1"
	node -e '
		const m = require(process.argv[1]);
		console.log(m.scope.join("\n"));
	' "$MANIFEST" | while IFS= read -r entry; do
		mkdir -p "$dest/$(dirname "$entry")"
		cp -R "$PLUGIN_ROOT/skills/$entry" "$dest/$entry"
	done
}

# _edit_manifest dest script — write a copy of the manifest to dest after
# applying a JS mutation to the parsed object `m`.
_edit_manifest() {
	node -e '
		const fs = require("node:fs");
		const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
		eval(process.argv[3]);
		fs.writeFileSync(process.argv[2], JSON.stringify(m));
	' "$MANIFEST" "$1" "$2"
}

@test "the helper and its manifest exist" {
	[ -f "$HELPER" ]
	[ -f "$MANIFEST" ]
}

@test "the vendored Effect tree is present" {
	[ -f "$REPO_ROOT/.repos/effect/packages/effect/src/Effect.ts" ]
}

@test "positive control: every in-scope anchor lands on its symbol" {
	run node "$HELPER" --repo "$REPO_ROOT"
	echo "$output"
	[ "$status" -eq 0 ]
	[[ "$output" == *", 0 failures"* ]]
	# Guard against a scope that silently matched nothing.
	local anchors
	anchors="$(sed -nE 's/.* ([0-9]+) anchors,.*/\1/p' <<<"$output")"
	[ "$anchors" -ge 100 ]
}

@test "negative control: a manifest line moved off its symbol fails and names the anchor" {
	local mutated="$BATS_TEST_TMPDIR/manifest.json"
	_edit_manifest "$mutated" '
		const e = m.anchors.find((a) => a.file === "effect-v4-testing/SKILL.md" && a.anchor === "FileSystem.ts:636");
		e.anchor = "FileSystem.ts:636"; e.symbols = { "636": "export const layerNoop" };
	'
	run node "$HELPER" --repo "$REPO_ROOT" --manifest "$mutated"
	echo "$output"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL effect-v4-testing/SKILL.md: FileSystem.ts:636 -> effect:FileSystem.ts:636 does not contain"* ]]
}

@test "negative control: a skill anchor rewritten to a stale line fails coverage both ways" {
	local skills="$BATS_TEST_TMPDIR/skills"
	_copy_scope "$skills"
	sed -i.bak 's/`makeNoop` (`FileSystem.ts:636`)/`makeNoop` (`FileSystem.ts:825`)/' "$skills/effect-v4-testing/SKILL.md"
	grep -q 'FileSystem.ts:825' "$skills/effect-v4-testing/SKILL.md"
	run node "$HELPER" --repo "$REPO_ROOT" --skills "$skills"
	echo "$output"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL effect-v4-testing/SKILL.md: anchor FileSystem.ts:825 is not in the manifest"* ]]
	[[ "$output" == *"FAIL manifest entry effect-v4-testing/SKILL.md: FileSystem.ts:636 does not occur"* ]]
}

@test "negative control: an anchor missing from the manifest fails" {
	local mutated="$BATS_TEST_TMPDIR/manifest.json"
	_edit_manifest "$mutated" '
		m.anchors = m.anchors.filter((a) => !(a.file === "effect-v4-cli/references/gotchas.md" && a.anchor === "unstable/cli/Command.ts:1448"));
	'
	run node "$HELPER" --repo "$REPO_ROOT" --manifest "$mutated"
	echo "$output"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL effect-v4-cli/references/gotchas.md: anchor unstable/cli/Command.ts:1448 is not in the manifest"* ]]
}
