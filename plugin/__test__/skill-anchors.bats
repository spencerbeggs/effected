#!/usr/bin/env bats
# skill-anchors.bats — pins every `File.ts:N` source anchor in every skill file
# to the symbol it names, and pins the re-deriver that moves them.
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
# failure mode can fire. The rederive controls run scripts/rederive-anchors.mjs
# over the small tree in fixtures/skill-anchors (a fake source root, one skill
# file and a manifest), moving the source by known amounts. Everything mutable
# is a copy in BATS_TEST_TMPDIR; nothing touches the committed tree.

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
REPO_ROOT="$(cd "$PLUGIN_ROOT/.." && pwd)"
HELPER="$PLUGIN_ROOT/__test__/helpers/skill-anchors.mjs"
MANIFEST="$PLUGIN_ROOT/__test__/helpers/skill-anchors.json"
REDERIVE="$PLUGIN_ROOT/scripts/rederive-anchors.mjs"
FIXTURE="$PLUGIN_ROOT/__test__/fixtures/skill-anchors"

# _copy_skills dest — copy the whole skills tree into dest.
_copy_skills() {
	mkdir -p "$1"
	cp -R "$PLUGIN_ROOT/skills/." "$1"
}

# _edit_manifest src dest script — write a copy of the manifest at src to dest
# after applying a JS mutation to the parsed object `m`.
_edit_manifest() {
	node -e '
		const fs = require("node:fs");
		const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
		eval(process.argv[3]);
		fs.writeFileSync(process.argv[2], JSON.stringify(m, null, "\t"));
	' "$1" "$2" "$3"
}

# _fixture — copy the rederive fixture tree to $FX and define the run helpers.
_fixture() {
	FX="$BATS_TEST_TMPDIR/fx"
	cp -R "$FIXTURE" "$FX"
}
_rederive() {
	run node "$REDERIVE" --repo "$FX" --skills "$FX/skills" --manifest "$FX/manifest.json" "$@"
	echo "$output"
}
_check_fixture() {
	run node "$HELPER" --repo "$FX" --skills "$FX/skills" --manifest "$FX/manifest.json"
	echo "$output"
}

# _splice line count [text] — insert `count` lines of text (default a filler
# comment) into the fixture source after line `line`.
_splice() {
	node -e '
		const fs = require("node:fs");
		const [path, after, count, text] = process.argv.slice(1);
		const lines = fs.readFileSync(path, "utf8").split("\n");
		lines.splice(Number(after), 0, ...Array.from({ length: Number(count) }, () => text));
		fs.writeFileSync(path, lines.join("\n"));
	' "$FX/src/Mod.ts" "$1" "$2" "${3:-// inserted}"
}

# _set_line line text — replace one line of the fixture source.
_set_line() {
	node -e '
		const fs = require("node:fs");
		const [path, at, text] = process.argv.slice(1);
		const lines = fs.readFileSync(path, "utf8").split("\n");
		lines[Number(at) - 1] = text;
		fs.writeFileSync(path, lines.join("\n"));
	' "$FX/src/Mod.ts" "$1" "$2"
}

@test "the helper, the re-deriver and the manifest exist" {
	[ -f "$HELPER" ]
	[ -f "$REDERIVE" ]
	[ -f "$MANIFEST" ]
}

@test "the vendored Effect tree is present" {
	[ -f "$REPO_ROOT/.repos/effect/packages/effect/src/Effect.ts" ]
}

@test "positive control: every skill file is in scope and every anchor lands on its symbol" {
	run node "$HELPER" --repo "$REPO_ROOT"
	echo "$output"
	[ "$status" -eq 0 ]
	[[ "$output" == *", 0 failures"* ]]
	# The scope is the whole tree, not a list someone has to extend.
	[ "$(node -e 'console.log(JSON.stringify(require(process.argv[1]).scope))' "$MANIFEST")" = '["."]' ]
	# The file count must match an independent walk, so a tokenizer or walker
	# that silently skipped files cannot pass.
	local files expected anchors
	files="$(sed -nE 's/^([0-9]+) skill files,.*/\1/p' <<<"$output")"
	expected="$(find "$PLUGIN_ROOT/skills" -name '*.md' -type f | wc -l | tr -d ' ')"
	[ "$files" -eq "$expected" ]
	anchors="$(sed -nE 's/.* ([0-9]+) anchors,.*/\1/p' <<<"$output")"
	[ "$anchors" -ge 250 ]
}

@test "positive control: the re-deriver finds every real anchor where the manifest says, uniquely" {
	run node "$REDERIVE" --repo "$REPO_ROOT"
	echo "$output"
	[ "$status" -eq 0 ]
	[[ "$output" == "0 moved, 0 refused" ]]
}

@test "negative control: a manifest line moved off its symbol fails and names the anchor" {
	local mutated="$BATS_TEST_TMPDIR/manifest.json"
	_edit_manifest "$MANIFEST" "$mutated" '
		const e = m.anchors.find((a) => a.file === "effect-v4-testing/SKILL.md" && a.anchor === "FileSystem.ts:654");
		e.symbols = { "654": "export const layerNoop" };
	'
	run node "$HELPER" --repo "$REPO_ROOT" --manifest "$mutated"
	echo "$output"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL effect-v4-testing/SKILL.md: FileSystem.ts:654 -> effect:FileSystem.ts:654 does not contain"* ]]
}

@test "negative control: a skill anchor rewritten to a stale line fails coverage both ways" {
	local skills="$BATS_TEST_TMPDIR/skills"
	_copy_skills "$skills"
	sed -i.bak 's/`makeNoop` (`FileSystem.ts:654`)/`makeNoop` (`FileSystem.ts:825`)/' "$skills/effect-v4-testing/SKILL.md"
	grep -q 'FileSystem.ts:825' "$skills/effect-v4-testing/SKILL.md"
	run node "$HELPER" --repo "$REPO_ROOT" --skills "$skills"
	echo "$output"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL effect-v4-testing/SKILL.md: anchor FileSystem.ts:825 is not in the manifest"* ]]
	[[ "$output" == *"FAIL manifest entry effect-v4-testing/SKILL.md: FileSystem.ts:654 does not occur"* ]]
}

@test "negative control: an anchor missing from the manifest fails" {
	local mutated="$BATS_TEST_TMPDIR/manifest.json"
	_edit_manifest "$MANIFEST" "$mutated" '
		m.anchors = m.anchors.filter((a) => !(a.file === "effect-v4-cli/references/gotchas.md" && a.anchor === "cli/Command.ts:1605"));
	'
	run node "$HELPER" --repo "$REPO_ROOT" --manifest "$mutated"
	echo "$output"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL effect-v4-cli/references/gotchas.md: anchor cli/Command.ts:1605 is not in the manifest"* ]]
}

@test "negative control: a new citation in a skill the old scope never covered fails coverage" {
	local skills="$BATS_TEST_TMPDIR/skills"
	_copy_skills "$skills"
	printf '\nSee `Effect.ts:4242` for the details.\n' >>"$skills/effect-v4-idioms/SKILL.md"
	run node "$HELPER" --repo "$REPO_ROOT" --skills "$skills"
	echo "$output"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL effect-v4-idioms/SKILL.md: anchor Effect.ts:4242 is not in the manifest"* ]]
}

@test "negative control: a range whose end line has no symbol fails" {
	local mutated="$BATS_TEST_TMPDIR/manifest.json"
	_edit_manifest "$MANIFEST" "$mutated" '
		const e = m.anchors.find((a) => a.anchor === "Runtime.ts:211-217");
		delete e.symbols["217"];
	'
	run node "$HELPER" --repo "$REPO_ROOT" --manifest "$mutated"
	echo "$output"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL effect-v4-mcp/references/server-wiring.md: Runtime.ts:211-217 -> range end 217 has no symbol in the manifest"* ]]
}

@test "negative control: a symbol on a comment line fails unless the entry says comment" {
	local mutated="$BATS_TEST_TMPDIR/manifest.json"
	_edit_manifest "$MANIFEST" "$mutated" '
		const e = m.anchors.find((a) => a.file === "effect-v4-module-index/SKILL.md" && a.anchor === "Cache.ts:4");
		if (e.comment !== true) throw new Error("fixture drift: Cache.ts:4 is no longer a docstring quote");
		delete e.comment;
	'
	run node "$HELPER" --repo "$REPO_ROOT" --manifest "$mutated"
	echo "$output"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL effect-v4-module-index/SKILL.md: Cache.ts:4 -> effect:Cache.ts:4 is a comment line"* ]]
}

@test "negative control: a bare :NNN citation that names no file fails" {
	local skills="$BATS_TEST_TMPDIR/skills"
	_copy_skills "$skills"
	printf '\nThe docstring at :2424 says so.\n' >>"$skills/effect-v4-idioms/SKILL.md"
	run node "$HELPER" --repo "$REPO_ROOT" --skills "$skills"
	echo "$output"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL effect-v4-idioms/SKILL.md:"*": bare citation :2424 names no file"* ]]
}

@test "negative control: a prose line citation beside a named file fails" {
	local skills="$BATS_TEST_TMPDIR/skills"
	_copy_skills "$skills"
	printf '\nIn `src/Logger.ts`, `consoleJson` is at 992.\n' >>"$skills/effect-v4-idioms/SKILL.md"
	run node "$HELPER" --repo "$REPO_ROOT" --skills "$skills"
	echo "$output"
	[ "$status" -eq 1 ]
	[[ "$output" == *'FAIL effect-v4-idioms/SKILL.md:'*': prose citation "at 992" is unchecked'* ]]
}

@test "negative control: a second occurrence of a listed token fails until the manifest counts it" {
	local skills="$BATS_TEST_TMPDIR/skills"
	_copy_skills "$skills"
	# index.ts:195 is listed once for this file; a new, false claim reuses it.
	[ "$(grep -o 'index.ts:195' "$skills/effect-v4-source-lookup/SKILL.md" | wc -l | tr -d ' ')" -eq 1 ]
	printf '\nThe vitest `layer` helper is declared at `index.ts:195`.\n' >>"$skills/effect-v4-source-lookup/SKILL.md"
	run node "$HELPER" --repo "$REPO_ROOT" --skills "$skills"
	echo "$output"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL effect-v4-source-lookup/SKILL.md: anchor index.ts:195 occurs 2 times but the manifest declares 1"* ]]
}

@test "negative control: a token whose path is not its entry's source fails" {
	local mutated="$BATS_TEST_TMPDIR/manifest.json"
	_edit_manifest "$MANIFEST" "$mutated" '
		m.anchors.find((a) => a.anchor === "Runtime.ts:211-217").source = "effect:Layer.ts";
	'
	run node "$HELPER" --repo "$REPO_ROOT" --manifest "$mutated"
	echo "$output"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL effect-v4-mcp/references/server-wiring.md: Runtime.ts:211-217 -> the token names Runtime.ts, but the entry checks effect:Layer.ts"* ]]
}

@test "a trailing comma does not make a second token: X.ts:163, and X.ts:163 share one entry" {
	local skills="$BATS_TEST_TMPDIR/skills"
	_copy_skills "$skills"
	# The real tree writes the comma form; add the bare form beside it.
	grep -q 'PlatformError.ts:163,' "$skills/effect-v4-idioms/SKILL.md"
	printf '\nAgain: `PlatformError.ts:163`.\n' >>"$skills/effect-v4-idioms/SKILL.md"
	# Both spellings count against the one entry: the bare form is a second
	# occurrence of it, not an unlisted token of its own.
	run node "$HELPER" --repo "$REPO_ROOT" --skills "$skills"
	echo "$output"
	[[ "$output" == *"FAIL effect-v4-idioms/SKILL.md: anchor PlatformError.ts:163 occurs 2 times but the manifest declares 1"* ]]
	[[ "$output" != *"is not in the manifest"* ]]
	# Once the manifest counts both, the tree is clean.
	local mutated="$BATS_TEST_TMPDIR/manifest.json"
	_edit_manifest "$MANIFEST" "$mutated" '
		m.anchors.find((a) => a.file === "effect-v4-idioms/SKILL.md" && a.anchor === "PlatformError.ts:163").occurrences = 2;
	'
	run node "$HELPER" --repo "$REPO_ROOT" --skills "$skills" --manifest "$mutated"
	echo "$output"
	[ "$status" -eq 0 ]
	[[ "$output" == *", 0 failures"* ]]
}

@test "rederive fixture: the untouched fixture checks clean and moves nothing" {
	_fixture
	_check_fixture
	[ "$status" -eq 0 ]
	_rederive
	[ "$status" -eq 0 ]
	[[ "$output" == "0 moved, 0 refused" ]]
}

@test "rederive fixture: a declaration moved +7 lines is relocated in the manifest and the skill" {
	_fixture
	_splice 2 7
	_rederive --write
	[ "$status" -eq 0 ]
	grep -qF '`alpha` lives at `Mod.ts:17`, and `beta` at `Mod.ts:27`.' "$FX/skills/demo/SKILL.md"
	node -e '
		const m = require(process.argv[1]);
		const e = m.anchors.find((a) => a.anchor === "Mod.ts:17");
		if (e === undefined || e.symbols["17"] !== "export const alpha") process.exit(1);
	' "$FX/manifest.json"
	_check_fixture
	[ "$status" -eq 0 ]
}

@test "rederive fixture: five identical lines in one function are refused as AMBIGUOUS without after" {
	_fixture
	_edit_manifest "$FX/manifest.json" "$FX/manifest.json" '
		delete m.anchors.find((a) => a.anchor === "Mod.ts:84").after;
	'
	cp "$FX/manifest.json" "$BATS_TEST_TMPDIR/manifest.before"
	cp "$FX/skills/demo/SKILL.md" "$BATS_TEST_TMPDIR/skill.before"
	_rederive --write
	[ "$status" -eq 1 ]
	[[ "$output" == *'AMBIGUOUS demo/SKILL.md: Mod.ts:84 -> "return die(\"not implemented\")" on lines 72, 75, 78, 81, 84'* ]]
	[[ "$output" == *"nothing written"* ]]
	cmp "$FX/manifest.json" "$BATS_TEST_TMPDIR/manifest.before"
	cmp "$FX/skills/demo/SKILL.md" "$BATS_TEST_TMPDIR/skill.before"
}

@test "rederive fixture: after on the enclosing member line picks the right one of five" {
	_fixture
	# A line added inside the third member moves only the stubs below it.
	_splice 78 1 '		// inserted'
	_rederive --write
	[ "$status" -eq 0 ]
	grep -qF 'The fifth stub is `Mod.ts:85`.' "$FX/skills/demo/SKILL.md"
	_check_fixture
	[ "$status" -eq 0 ]
}

@test "rederive fixture: a chain of moves (A to B, B to C) ends on two distinct lines" {
	_fixture
	# Ten lines move alpha onto beta's old line and beta onto gamma's.
	_splice 2 10
	_rederive --write
	[ "$status" -eq 0 ]
	grep -qF '`alpha` lives at `Mod.ts:20`, and `beta` at `Mod.ts:30`.' "$FX/skills/demo/SKILL.md"
	grep -qF '`gamma` starts at `Mod.ts:40`; its whole body is `Mod.ts:40-46`.' "$FX/skills/demo/SKILL.md"
	grep -qF '`delta` (`Mod.ts:50`) and `epsilon` (`Mod.ts:60`).' "$FX/skills/demo/SKILL.md"
	_check_fixture
	[ "$status" -eq 0 ]
}

@test "rederive fixture: :30 and :30-36 rewrite independently, and a grown range end follows its symbol" {
	_fixture
	# Three lines inside gamma's body: the start stays, the end moves.
	_splice 31 3 '	const pad = 0'
	_rederive --write
	[ "$status" -eq 0 ]
	grep -qF '`gamma` starts at `Mod.ts:30`; its whole body is `Mod.ts:30-39`.' "$FX/skills/demo/SKILL.md"
	grep -qF '`delta` (`Mod.ts:43`)' "$FX/skills/demo/SKILL.md"
	_check_fixture
	[ "$status" -eq 0 ]
}

@test "rederive fixture: a symbol that is gone prints MISSING and writes nothing" {
	_fixture
	_set_line 40 'export const omega = 1'
	cp "$FX/skills/demo/SKILL.md" "$BATS_TEST_TMPDIR/skill.before"
	_splice 2 4
	_rederive --write
	[ "$status" -eq 1 ]
	[[ "$output" == *'MISSING demo/SKILL.md: Mod.ts:40 -> "export const delta" not found'* ]]
	[[ "$output" == *"nothing written"* ]]
	cmp "$FX/skills/demo/SKILL.md" "$BATS_TEST_TMPDIR/skill.before"
}

@test "rederive fixture: two anchors that would become one token are refused as a COLLISION" {
	_fixture
	_set_line 40 'export const delta = 1; export const epsilon = 2'
	_set_line 50 '// filler'
	cp "$FX/skills/demo/SKILL.md" "$BATS_TEST_TMPDIR/skill.before"
	_rederive --write
	[ "$status" -eq 1 ]
	[[ "$output" == *"COLLISION demo/SKILL.md: Mod.ts:40 and Mod.ts:50 would both become Mod.ts:40"* ]]
	cmp "$FX/skills/demo/SKILL.md" "$BATS_TEST_TMPDIR/skill.before"
}

@test "rederive fixture: a removed declaration is not relocated onto one its name prefixes" {
	_fixture
	# Only `export const layerNoop` still contains the text `export const layer`.
	_set_line 60 '// filler'
	_rederive
	[ "$status" -eq 1 ]
	[[ "$output" == *'MISSING demo/SKILL.md: Mod.ts:60 -> "export const layer" not found'* ]]
	[[ "$output" != *"MOVED demo/SKILL.md: Mod.ts:60"* ]]
}

@test "rederive fixture: a guarded stub that loses its symbol is refused, not moved onto its sibling" {
	_fixture
	printf 'The third stub is `Mod.ts:78`.\n' >>"$FX/skills/demo/SKILL.md"
	_edit_manifest "$FX/manifest.json" "$FX/manifest.json" '
		m.anchors.push({ file: "demo/SKILL.md", anchor: "Mod.ts:78", source: "src:Mod.ts", symbols: { "78": "return die(\"not implemented\")" }, after: "third() {" });
	'
	_rederive
	[ "$status" -eq 0 ]
	# The third member stops dying; the fourth, below it, still carries the text.
	_set_line 78 '		return succeed(undefined)'
	cp "$FX/skills/demo/SKILL.md" "$BATS_TEST_TMPDIR/skill.before"
	_rederive --write
	[ "$status" -eq 1 ]
	[[ "$output" == *'MISSING demo/SKILL.md: Mod.ts:78 -> "return die(\"not implemented\")" not found in the block of line 77'* ]]
	[[ "$output" != *"MOVED demo/SKILL.md: Mod.ts:78"* ]]
	cmp "$FX/skills/demo/SKILL.md" "$BATS_TEST_TMPDIR/skill.before"
}

@test "rederive fixture: a symbol is not matched mid-word on its left" {
	_fixture
	_edit_manifest "$FX/manifest.json" "$FX/manifest.json" '
		m.anchors.find((a) => a.anchor === "Mod.ts:60").symbols = { "60": "layer = 3" };
	'
	# Only the leading word bound tells `layer = 3` from `sublayer = 3`.
	_set_line 64 'export const sublayer = 3'
	_rederive
	[ "$status" -eq 0 ]
	[[ "$output" == "0 moved, 0 refused" ]]
	_set_line 60 '// filler'
	_rederive
	[ "$status" -eq 1 ]
	[[ "$output" == *'MISSING demo/SKILL.md: Mod.ts:60 -> "layer = 3" not found'* ]]
	[[ "$output" != *"MOVED demo/SKILL.md: Mod.ts:60"* ]]
}
