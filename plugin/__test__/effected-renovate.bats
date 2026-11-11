#!/usr/bin/env bats
# effected-renovate.bats — the effected-renovate skill's scripts and its ledger.
#
# Most cases run the source scripts against fixtures built in each test's temp
# directory. The last cases pin the real ledger (every entry valid, every
# pending breaking changeset named by an entry) and run the BUILT script once
# per host, which proves it ships and runs with none of the plugin variables.
# Run `pnpm build --filter @effected/ai-plugins` first for those.

load "$BATS_TEST_DIRNAME/../node_modules/pluginfinity/bats/pluginfinity.bash"

PLUGIN_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
REPO_ROOT="$(cd "$PLUGIN_ROOT/.." && pwd)"
SCRIPTS="$PLUGIN_ROOT/skills/effected-renovate/scripts"
LEDGER="$PLUGIN_ROOT/skills/effected-renovate/references/ledger"

# _lockfile <file> <effect> <kit> — a two-document pnpm lockfile: the config
# dependency document, then an importer with effect, one kit package and a link.
_lockfile() {
	cat >"$1" <<EOF
---
lockfileVersion: '9.0'

importers:

  .:
    configDependencies:
      '@effected/pnpm-plugin-effected':
        specifier: 0.20.0
        version: 0.20.0

---
lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@effected/crypto':
        specifier: ^$3
        version: $3(effect@$2)
      effect:
        specifier: ~$2
        version: $2
      local-thing:
        specifier: workspace:*
        version: link:packages/local-thing

packages:

  effect@$2:
    resolution: {integrity: sha512-x}
EOF
}

# _entry <dir> <id> <kind> <shows> <applies-pkg> <threshold> [detect]
_entry() {
	local detect="${7:-}"
	{
		printf -- '---\nid: "%s"\ntitle: Entry %s\nkind: %s\nshows: %s\napplies:\n  "%s": ">=%s"\n' "$2" "$2" "$3" "$4" "$5" "$6"
		[ -n "$detect" ] && printf 'detect: ["%s"]\n' "$detect"
		printf -- '---\n\nWhat changed and how to fix it.\n'
	} >"$1/$2-entry.md"
}

# _baseline <dir> <previous> [floor-effect]
_baseline() {
	{
		printf -- '---\nrepo: owner/repo\npath: plugin/skills/effected-renovate/references/ledger\nprevious: %s\nfloor:\n  effect: "%s"\n---\n\nBaseline.\n' "$2" "${3:-4.0.7}"
	} >"$1/BASELINE.md"
}

# _named_changesets <ledger-dir> — every changeset name any entry lists, one per
# line, read with applicable.mjs's own parser so flow and block lists both count.
_named_changesets() {
	node --input-type=module -e '
		import { readLedger } from "'"$SCRIPTS"'/applicable.mjs";
		for (const e of readLedger(process.argv[1]).entries) for (const n of e.changesets ?? []) console.log(n);' "$1"
}

setup() {
	PROJECT="$BATS_TEST_TMPDIR/project"
	LEDGER_FIX="$BATS_TEST_TMPDIR/ledger"
	mkdir -p "$PROJECT/src" "$LEDGER_FIX"
	git -C "$PROJECT" init -q
	printf 'import { Crypto } from "effect"\nconst x = Crypto.hash\n' >"$PROJECT/src/hash.ts"
	git -C "$PROJECT" add -A
	git -C "$PROJECT" -c user.email=t@t -c user.name=t commit -qm init
	_lockfile "$BATS_TEST_TMPDIR/before.yaml" 4.0.7 0.3.2
	_lockfile "$BATS_TEST_TMPDIR/after.yaml" 4.1.1 0.4.0
	_baseline "$LEDGER_FIX" none
}

_applicable() {
	run node "$SCRIPTS/applicable.mjs" --root "$PROJECT" --ledger "$LEDGER_FIX" \
		--before "$BATS_TEST_TMPDIR/before.yaml" --after "$BATS_TEST_TMPDIR/after.yaml" "$@"
}

@test "lockfile: reads both documents, strips peer suffixes, skips link resolutions" {
	run node --input-type=module -e '
		import { lockfileVersions } from "'"$SCRIPTS"'/applicable.mjs";
		import { readFileSync } from "node:fs";
		const v = lockfileVersions(readFileSync(process.argv[1], "utf8"));
		console.log(JSON.stringify(Object.fromEntries(v)));' "$BATS_TEST_TMPDIR/after.yaml"
	[ "$status" -eq 0 ]
	[ "$output" = '{"@effected/pnpm-plugin-effected":["0.20.0"],"@effected/crypto":["0.4.0"],"effect":["4.1.1"]}' ]
}

@test "versions: a prerelease sorts below its release, numeric identifiers numerically" {
	run node --input-type=module -e '
		import { compareVersions as c } from "'"$SCRIPTS"'/applicable.mjs";
		console.log([c("4.0.0-rc.9","4.0.0-rc.10")<0, c("4.0.0-rc.118","4.0.0")<0, c("4.1.0","4.0.7")>0, c("0.10.0","0.9.9")>0].join(" "));'
	[ "$output" = "true true true true" ]
}

@test "an entry applies when the upgrade crosses its threshold, with the hits it finds" {
	_entry "$LEDGER_FIX" 0001 breaking typed effect 4.1.0 'Crypto\\.'
	_applicable
	[ "$status" -eq 0 ]
	[[ "$output" == *"applicable: 1 of 1 ledger entries apply"* ]]
	[[ "$output" == *"crossed: effect 4.0.7 -> 4.1.1 (>=4.1.0)"* ]]
	[[ "$output" == *"src/hash.ts:2:const x = Crypto.hash"* ]]
}

@test "an entry the upgrade did not cross is not listed" {
	_entry "$LEDGER_FIX" 0001 breaking typed effect 4.0.5 'Crypto\\.'
	_entry "$LEDGER_FIX" 0002 breaking typed effect 4.2.0 'Crypto\\.'
	_applicable
	[[ "$output" == *"applicable: 0 of 2 ledger entries apply"* ]]
}

@test "a package the repository did not depend on before does not trigger an entry" {
	_entry "$LEDGER_FIX" 0001 adopt none "@effected/brand-new" 0.1.0
	_applicable
	[[ "$output" == *"0 of 1"* ]]
}

@test "entries print security first, and typed before behavioural within a kind" {
	_entry "$LEDGER_FIX" 0001 adopt none effect 4.1.0
	_entry "$LEDGER_FIX" 0002 breaking behavioural effect 4.1.0 'nothing-here'
	_entry "$LEDGER_FIX" 0003 breaking typed "@effected/crypto" 0.4.0 'Crypto'
	_entry "$LEDGER_FIX" 0004 security behavioural effect 4.1.0 'x'
	_applicable --json
	run node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(d.entries.map(e => e.id).join(" "))' <<<"$output"
	[ "$output" = "0004 0003 0002 0001" ]
}

@test "an entry with a detect pattern that finds nothing says so" {
	_entry "$LEDGER_FIX" 0001 behaviour behavioural effect 4.1.0 'not-in-the-code'
	_applicable
	[[ "$output" == *"hits: none"* ]]
}

@test "detect: committed build output cannot overflow git's buffer or flood the hits" {
	# A minified one-line bundle bigger than execFileSync's default 1 MiB maxBuffer,
	# under dist/, a nested dist/ and a local action, each holding the detect term.
	mkdir -p "$PROJECT/dist" "$PROJECT/pkg/dist" "$PROJECT/.github/actions/local/x" "$PROJECT/other"
	node -e 'process.stdout.write("Crypto.hash;" + "a".repeat(3 * 1024 * 1024))' >"$PROJECT/dist/bundle.js"
	cp "$PROJECT/dist/bundle.js" "$PROJECT/pkg/dist/bundle.js"
	cp "$PROJECT/dist/bundle.js" "$PROJECT/.github/actions/local/x/index.js"
	# A bundle in a path nothing excludes: its hit line must be capped, not flooded.
	cp "$PROJECT/dist/bundle.js" "$PROJECT/other/min.js"
	git -C "$PROJECT" add -A
	git -C "$PROJECT" -c user.email=t@t -c user.name=t commit -qm bundles
	_entry "$LEDGER_FIX" 0001 breaking typed effect 4.1.0 'Crypto\\.'
	_applicable
	[ "$status" -eq 0 ]
	[[ "$output" == *"src/hash.ts:2:const x = Crypto.hash"* ]]
	[[ "$output" != *"dist/bundle.js"* ]]
	[[ "$output" != *".github/actions/local"* ]]
	[[ "$output" == *"other/min.js:1:Crypto.hash;"* ]]
	[ "${#output}" -lt 5000 ]
}

@test "--check accepts a valid ledger" {
	_entry "$LEDGER_FIX" 0001 breaking typed effect 4.1.0 'x'
	run node "$SCRIPTS/applicable.mjs" --check --ledger "$LEDGER_FIX"
	[ "$status" -eq 0 ]
	[[ "$output" == *"1 entries valid"* ]]
}

@test "--check rejects a mismatched id, a bad threshold and a breaking entry without detect" {
	printf -- '---\nid: "0009"\ntitle: T\nkind: breaking\nshows: typed\napplies:\n  effect: "4.1.0"\n---\n\nBody.\n' >"$LEDGER_FIX/0001-bad.md"
	run node "$SCRIPTS/applicable.mjs" --check --ledger "$LEDGER_FIX"
	[ "$status" -eq 1 ]
	[[ "$output" == *'id "0009" does not match the file name'* ]]
	[[ "$output" == *'applies.effect: "4.1.0" is not >=X.Y.Z'* ]]
	[[ "$output" == *"needs at least one detect pattern"* ]]
}

@test "a repository older than the earliest round gets a notice" {
	_baseline "$LEDGER_FIX" none 4.1.0
	_applicable
	[[ "$output" == *"predates the earliest ledger round (effect 4.1.0)"* ]]
}

@test "--offline names the earlier round instead of fetching it" {
	_baseline "$LEDGER_FIX" "@effected/ai-plugins@0.40.0" 4.1.0
	_applicable --offline
	[ "$status" -eq 0 ]
	[[ "$output" == *"the earlier round is at @effected/ai-plugins@0.40.0"* ]]
}

@test "a repository older than the baseline gets the earlier round from the previous tag, with gh's inherited host scrubbed" {
	_baseline "$LEDGER_FIX" "@effected/ai-plugins@0.40.0" 4.1.0
	_entry "$LEDGER_FIX" 0001 breaking typed effect 4.1.0 'Crypto\\.'
	# The earlier round: its own baseline (the end of the chain) and one entry.
	local old="$BATS_TEST_TMPDIR/old"
	mkdir -p "$old" "$BATS_TEST_TMPDIR/bin"
	_baseline "$old" none 4.0.0
	_entry "$old" 0001 behaviour behavioural effect 4.0.7 'Crypto'
	# A stub gh: lists the directory, then serves each file base64-encoded.
	# It records GH_HOST so the test can prove the inherited value never reaches it.
	cat >"$BATS_TEST_TMPDIR/bin/gh" <<EOF
#!/usr/bin/env bash
echo "GH_HOST=\${GH_HOST:-unset} \$*" >>"$BATS_TEST_TMPDIR/gh.log"
case "\$2" in
	*ledger\?ref=*) printf '[{"type":"file","name":"BASELINE.md","path":"p/BASELINE.md"},{"type":"file","name":"0001-entry.md","path":"p/0001-entry.md"}]' ;;
	*BASELINE.md*) base64 <"$old/BASELINE.md" ;;
	*0001-entry.md*) base64 <"$old/0001-entry.md" ;;
esac
EOF
	chmod +x "$BATS_TEST_TMPDIR/bin/gh"
	_lockfile "$BATS_TEST_TMPDIR/before.yaml" 4.0.5 0.3.2
	PATH="$BATS_TEST_TMPDIR/bin:$PATH" GH_HOST=evil.example XDG_STATE_HOME="$BATS_TEST_TMPDIR/state" _applicable
	[ "$status" -eq 0 ]
	[[ "$output" == *"applicable: 2 of 2 ledger entries apply"* ]]
	[[ "$output" == *"read: $BATS_TEST_TMPDIR/state/effected/renovate/@effected_ai-plugins@0.40.0/0001-entry.md"* ]]
	grep -q 'GH_HOST=unset api repos/owner/repo/contents/plugin/skills/effected-renovate/references/ledger?ref=%40effected%2Fai-plugins%400.40.0' "$BATS_TEST_TMPDIR/gh.log"
	! grep -q evil.example "$BATS_TEST_TMPDIR/gh.log"
}

@test "bump-config-deps: bumps, applies a ledger rename, and drops a legacy integrity suffix" {
	mkdir -p "$BATS_TEST_TMPDIR/bin"
	cat >"$BATS_TEST_TMPDIR/bin/pnpm" <<'EOF'
#!/usr/bin/env bash
case "$2" in
	@effected/pnpm-plugin-effected@latest) echo '"0.21.0"' ;;
	@savvy-web/pnpm-plugin-silk@latest) echo '"0.52.0"' ;;
	tool@latest) echo '"1.0.0"' ;;
esac
EOF
	chmod +x "$BATS_TEST_TMPDIR/bin/pnpm"
	printf -- '---\nid: "0001"\ntitle: Renamed\nkind: tooling\nshows: none\napplies:\n  effect: ">=4.1.0"\nrenames:\n  "@effected/pnpm-plugin-effect": "@effected/pnpm-plugin-effected"\n---\n\nBody.\n' >"$LEDGER_FIX/0001-renamed.md"
	cat >"$PROJECT/pnpm-workspace.yaml" <<'EOF'
configDependencies:
  "@effected/pnpm-plugin-effect": 0.19.0
  "@savvy-web/pnpm-plugin-silk": 0.51.3
  tool: 1.0.0+sha512-abc
packages:
  - packages/*
EOF
	PATH="$BATS_TEST_TMPDIR/bin:$PATH" run node "$SCRIPTS/bump-config-deps.mjs" "$PROJECT/pnpm-workspace.yaml" --ledger "$LEDGER_FIX"
	[ "$status" -eq 0 ]
	[[ "$output" == *"@effected/pnpm-plugin-effect 0.19.0 -> @effected/pnpm-plugin-effected 0.21.0 (renamed)"* ]]
	[[ "$output" == *"tool 1.0.0 (integrity dropped)"* ]]
	grep -qx '  "@effected/pnpm-plugin-effected": 0.21.0' "$PROJECT/pnpm-workspace.yaml"
	grep -qx '  "@savvy-web/pnpm-plugin-silk": 0.52.0' "$PROJECT/pnpm-workspace.yaml"
	grep -qx '  tool: 1.0.0' "$PROJECT/pnpm-workspace.yaml"
	grep -qx '  - packages/\*' "$PROJECT/pnpm-workspace.yaml"
}

@test "bump-config-deps: --dry-run writes nothing" {
	mkdir -p "$BATS_TEST_TMPDIR/bin"
	printf '#!/usr/bin/env bash\necho "\\"2.0.0\\""\n' >"$BATS_TEST_TMPDIR/bin/pnpm"
	chmod +x "$BATS_TEST_TMPDIR/bin/pnpm"
	printf 'configDependencies:\n  tool: 1.0.0\n' >"$PROJECT/pnpm-workspace.yaml"
	PATH="$BATS_TEST_TMPDIR/bin:$PATH" run node "$SCRIPTS/bump-config-deps.mjs" "$PROJECT/pnpm-workspace.yaml" --dry-run --ledger "$LEDGER_FIX"
	[[ "$output" == "tool 1.0.0 -> 2.0.0" ]]
	grep -qx '  tool: 1.0.0' "$PROJECT/pnpm-workspace.yaml"
}

@test "repo: the shipped ledger is valid" {
	run node "$SCRIPTS/applicable.mjs" --check
	[ "$status" -eq 0 ]
}

@test "repo: a repository below the shipped floor is pointed at the closed round" {
	local previous
	previous="$(sed -n 's/^previous: "\(.*\)"$/\1/p' "$LEDGER/BASELINE.md")"
	[ -n "$previous" ]
	XDG_STATE_HOME="$BATS_TEST_TMPDIR/state" run node "$SCRIPTS/applicable.mjs" --root "$PROJECT" --ledger "$LEDGER" \
		--offline --before "$BATS_TEST_TMPDIR/before.yaml" --after "$BATS_TEST_TMPDIR/after.yaml"
	[ "$status" -eq 0 ]
	[[ "$output" == *"the earlier round is at $previous"* ]]
}

@test "a rename's new name already resolved before keeps its own version" {
	printf -- '---\nid: "0001"\ntitle: R\nkind: tooling\nshows: none\napplies:\n  "@effected/pnpm-plugin-effected": ">=0.20.0"\nrenames:\n  "@effected/crypto": "@effected/pnpm-plugin-effected"\n---\n\nBody.\n' >"$LEDGER_FIX/0001-r.md"
	_applicable
	[[ "$output" == *"0 of 1"* ]]
}

@test "ledger gate: every changeset in a flow list counts, not only the last" {
	printf -- '---\nid: "0001"\ntitle: Two\nkind: tooling\nshows: none\napplies:\n  effect: ">=4.1.0"\nchangesets: ["first-one", "second-one"]\n---\n\nBody.\n' >"$LEDGER_FIX/0001-two.md"
	printf -- '---\nid: "0002"\ntitle: Block\nkind: tooling\nshows: none\napplies:\n  effect: ">=4.1.0"\nchangesets:\n  - third-one\n  - fourth-one\n---\n\nBody.\n' >"$LEDGER_FIX/0002-block.md"
	run _named_changesets "$LEDGER_FIX"
	[ "$status" -eq 0 ]
	[ "$output" = "$(printf 'first-one\nsecond-one\nthird-one\nfourth-one')" ]
}

@test "repo: every pending changeset with a breaking section is named by a ledger entry" {
	local missing=""
	local named
	named="$(_named_changesets "$LEDGER")"
	for cs in "$REPO_ROOT"/.changeset/*.md; do
		[ -e "$cs" ] || continue
		grep -q '^## Breaking Changes' "$cs" || continue
		local name
		name="$(basename "$cs" .md)"
		printf "%s\n" "$named" | grep -qxF "$name" || missing="$missing $name"
	done
	if [ -n "$missing" ]; then
		echo "breaking changesets with no ledger entry:$missing" >&2
		echo "record them with /effect-upgrade --record" >&2
		return 1
	fi
}

@test "built: applicable.mjs runs from both builds with only a skill script's environment" {
	for host in claude copilot; do
		run_script "$host" skills/effected-renovate/scripts/applicable.mjs --cwd "$PROJECT" --check
		[ "$status" -eq 0 ] || { echo "$host: $output $stderr" >&2; return 1; }
	done
}

@test "bump-config-deps: a rename carried in BASELINE.md survives a reset that removed its entry" {
	mkdir -p "$BATS_TEST_TMPDIR/bin"
	printf '#!/usr/bin/env bash\necho "\\"0.21.0\\""\n' >"$BATS_TEST_TMPDIR/bin/pnpm"
	chmod +x "$BATS_TEST_TMPDIR/bin/pnpm"
	printf -- '---\nrepo: owner/repo\npath: p\nprevious: none\nfloor:\n  effect: "4.1.0"\nrenames:\n  "@old/plugin": "@new/plugin"\n---\n\nBaseline.\n' >"$LEDGER_FIX/BASELINE.md"
	printf 'configDependencies:\n  "@old/plugin": 0.19.0\n' >"$PROJECT/pnpm-workspace.yaml"
	PATH="$BATS_TEST_TMPDIR/bin:$PATH" run node "$SCRIPTS/bump-config-deps.mjs" "$PROJECT/pnpm-workspace.yaml" --ledger "$LEDGER_FIX"
	[[ "$output" == "@old/plugin 0.19.0 -> @new/plugin 0.21.0 (renamed)" ]]
}

@test "--check rejects a detect pattern git grep -E cannot run" {
	_entry "$LEDGER_FIX" 0001 breaking typed effect 4.1.0 '4\\\\d'
	run node "$SCRIPTS/applicable.mjs" --check --ledger "$LEDGER_FIX"
	[ "$status" -eq 1 ]
	[[ "$output" == *'uses \d, which git grep -E does not support'* ]]
}

@test "frontmatter: block lists decode like flow lists, and a quoted # is part of the value" {
	run node --input-type=module -e '
		import { parseFrontmatter } from "'"$SCRIPTS"'/applicable.mjs";
		const f = parseFrontmatter("---\ntitle: \"Fix #12\"\ndetect:\n  - \"Crypto\\\\.\"\ncloses: [\"a\", \"b\"] # note\n---\n\nBody\n");
		console.log(JSON.stringify(f.data));'
	[ "$output" = '{"title":"Fix #12","detect":["Crypto\\."],"closes":["a","b"]}' ]
}

# ── stale-edges.mjs ──────────────────────────────────────────────────────────

STALE_FIXTURES="$PLUGIN_ROOT/__test__/fixtures/stale-edges"

@test "stale-edges: no split exits 0 and still counts the kit packages it read" {
	run node "$SCRIPTS/stale-edges.mjs" "$STALE_FIXTURES/no-split.yaml"
	[ "$status" -eq 0 ]
	# Positive control: both documents were parsed, so a parser that read nothing cannot pass.
	[ "$output" = "stale-edges: 2 kit packages, none at more than one version" ]
}

@test "stale-edges: a tool on a stale kit release gets one override line per tool edge" {
	run node "$SCRIPTS/stale-edges.mjs" "$STALE_FIXTURES/split.yaml"
	[ "$status" -eq 2 ]
	[[ "$output" == *"stale-edges: 2 of 4 kit packages resolve at more than one version"* ]]
	[[ "$output" == *"@effected/npm 0.34.0 (stale: 0.33.0)"* ]]
	[[ "$output" == *"@vitest-agent/plugin@6.0.10 -> @effected/npm@0.33.0"* ]]
	# optionalDependencies count as edges too.
	[[ "$output" == *"rolldown-pnpm-config@2.4.5 -> @effected/walker@0.27.0"* ]]
	local overrides
	overrides="$(sed -n '/^overrides:$/,$p' <<<"$output")"
	[ "$overrides" = "$(printf 'overrides:\n  "@vitest-agent/plugin>@effected/npm": "0.34.0"\n  "rolldown-pnpm-config>@effected/walker": "0.28.0"')" ]
}

@test "stale-edges: a kit parent and an importer are reported but never overridden" {
	run node "$SCRIPTS/stale-edges.mjs" "$STALE_FIXTURES/split.yaml"
	[ "$status" -eq 2 ]
	[[ "$output" == *"@effected/lockfiles@0.24.1 -> @effected/npm@0.33.0  (kit parent: the tool's line fixes it)"* ]]
	[[ "$output" == *". (importer) -> @effected/walker@0.27.0  (raise this repository's range)"* ]]
	[[ "$output" != *'"@effected/lockfiles>'* ]]
	[[ "$output" != *'".>'* ]]
}

@test "stale-edges: peer suffixes are stripped from snapshot keys and dependency versions" {
	run node --input-type=module -e '
		import { parseKey } from "'"$SCRIPTS"'/stale-edges.mjs";
		const k = parseKey("'"'"'@vitest-agent/plugin@6.0.10(@effected/npm@0.33.0(effect@4.1.3))(effect@4.1.3)'"'"'");
		console.log(JSON.stringify([k, parseKey("effect@4.1.3"), parseKey("link:../x")]));'
	[ "$status" -eq 0 ]
	[ "$output" = '[{"name":"@vitest-agent/plugin","version":"6.0.10"},{"name":"effect","version":"4.1.3"},null]' ]
	# Two snapshots of one tool, differing only by peer suffix, collapse to one edge.
	run node "$SCRIPTS/stale-edges.mjs" "$STALE_FIXTURES/split.yaml"
	[ "$(grep -c '@vitest-agent/plugin@6.0.10 -> ' <<<"$output")" -eq 1 ]
}

@test "stale-edges: --json carries the split, the edge kinds and the overrides" {
	run node "$SCRIPTS/stale-edges.mjs" --json "$STALE_FIXTURES/split.yaml"
	[ "$status" -eq 2 ]
	run node -e '
		const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
		console.log(d.kit, d.split.map(s => s.name).join(","), d.edges.map(e => e.kind).sort().join(","), JSON.stringify(d.overrides));' <<<"$output"
	[ "$output" = '4 @effected/npm,@effected/walker importer,kit,tool,tool {"@vitest-agent/plugin>@effected/npm":"0.34.0","rolldown-pnpm-config>@effected/walker":"0.28.0"}' ]
}

@test "stale-edges: reads ./pnpm-lock.yaml by default, 1 when unreadable, 64 on a bad argument" {
	cp "$STALE_FIXTURES/no-split.yaml" "$PROJECT/pnpm-lock.yaml"
	# pnpm run exports NODE_OPTIONS=--import=tsx, which cannot resolve from a temp project.
	run env -u NODE_OPTIONS bash -c "cd '$PROJECT' && node '$SCRIPTS/stale-edges.mjs'"
	[ "$status" -eq 0 ]
	[[ "$output" == *"2 kit packages"* ]]
	run node "$SCRIPTS/stale-edges.mjs" "$BATS_TEST_TMPDIR/missing.yaml"
	[ "$status" -eq 1 ]
	run node "$SCRIPTS/stale-edges.mjs" --nope
	[ "$status" -eq 64 ]
}

@test "built: stale-edges.mjs runs from both builds with only a skill script's environment" {
	for host in claude copilot; do
		run_script "$host" skills/effected-renovate/scripts/stale-edges.mjs "$STALE_FIXTURES/split.yaml"
		[ "$status" -eq 2 ] || { echo "$host: $status $output $stderr" >&2; return 1; }
		[[ "$output" == *'"@vitest-agent/plugin>@effected/npm": "0.34.0"'* ]]
	done
}
