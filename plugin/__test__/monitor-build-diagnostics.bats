#!/usr/bin/env bats
# monitor-build-diagnostics.bats — covers monitors/build-diagnostics.mjs, the
# Claude Code monitor that reports API Extractor and TSDoc diagnostics from an
# `effected package build`'s dist/prod/issues.json. Ported from the silk
# plugin's tsdoc-diagnostics monitor (savvy-web/systems#248, #255).
#
# dist/prod/issues.json is a shared, mutable, gitignored artifact, so the
# monitor reports only what it can vouch for:
#   1. buildOk === true (a crashed build writes empty buckets);
#   2. the artifact is at least as new as every build input it measures: the
#      package's src/ sources and the effected.toml files the build reads;
#   3. those same inputs are clean in git (a review tree is broken on purpose).
# Each gate is asserted as SILENCE, since a false positive here has already
# cost committed work (#255).
#
# Most tests run the BUILT script with --once, which reports a stable non-zero
# count at once and takes no lock. The registered command is run through
# pluginfinity's run_monitor. Run `pnpm build --filter @effected/ai-plugins`
# first. Monitors exist on Claude Code only.

bats_require_minimum_version 1.5.0

load "$BATS_TEST_DIRNAME/../node_modules/pluginfinity/bats/pluginfinity.bash"

BUILDS="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/builds"
MONITOR="$BUILDS/claude/monitors/build-diagnostics.mjs"

setup() {
	PROJECT="$BATS_TEST_TMPDIR/project"
	PKG="$PROJECT/packages/thing"
	mkdir -p "$PKG/src" "$PKG/dist/prod"
	printf 'export const a = 1;\n' >"$PKG/src/index.ts"
	printf '{"name":"@x/thing"}\n' >"$PKG/package.json"
	# The script's own log lines go under the test's temp directory.
	export XDG_STATE_HOME="$BATS_TEST_TMPDIR/state"
	export HOME="$BATS_TEST_TMPDIR/home"
	mkdir -p "$HOME"
	unset CLAUDE_PROJECT_DIR
	# Not a git repo: git status fails, so the clean-tree gate makes no claim
	# and each test isolates the other gates. The git tests opt in.
}

# _commit_all — make the project a git repo with everything committed.
_commit_all() {
	git -C "$PROJECT" init --quiet
	git -C "$PROJECT" add -A
	git -C "$PROJECT" -c user.email=t@t -c user.name=t -c commit.gpgsign=false commit --quiet -m seed
}

# _issues <buildOk-json> [warnings-json] — write an artifact stamped newer than
# the sources. The default holds one ciFatal ae-forgotten-export warning.
_issues() {
	local warnings=${2:-'[{"source":"api-extractor","level":"warn","code":"ae-forgotten-export","ciFatal":true,"text":"The symbol \"Q\" needs to be exported by the entry point index.d.ts"}]'}
	cat >"$PKG/dist/prod/issues.json" <<EOF
{"generatedAt":"2026-11-09T00:00:00.000Z","package":"@x/thing","target":"prod","buildOk":$1,
 "warnings":$warnings,"errors":[],"suppressed":[]}
EOF
	touch -t "$(date -v+1M +%Y%m%d%H%M.%S 2>/dev/null || date -d '+1 min' +%Y%m%d%H%M.%S)" "$PKG/dist/prod/issues.json"
}

_watch_once() {
	run --separate-stderr env -i PATH="$PATH" HOME="$HOME" XDG_STATE_HOME="$XDG_STATE_HOME" \
		CLAUDE_PROJECT_DIR="$PROJECT" "$@" node "$MONITOR" --once
}

@test "reports a vouched-for artifact, naming the file and the CI-fatal count" {
	_issues true
	_watch_once
	[ "$status" -eq 0 ]
	[[ "$output" == *"@x/thing has 1 ae-*/tsdoc-* diagnostic in packages/thing/dist/prod/issues.json"* ]]
	[[ "$output" == *"1 fails CI"* ]]
	[[ "$output" == *"reports an artifact"* ]]
	[ "$(printf '%s\n' "$output" | wc -l | tr -d ' ')" -eq 1 ]
}

@test "does not recommend dispatching a fixer" {
	_issues true
	_watch_once
	[[ "$output" != *"dispatch"* ]]
}

@test "counts ae-* and tsdoc-* codes in both buckets, and omits the CI note when none is CI-fatal" {
	_issues true '[{"source":"api-extractor","level":"warn","code":"ae-missing-release-tag","text":"x"},{"source":"api-extractor","level":"warn","code":"tsdoc-code-span-empty","text":"y"}]'
	_watch_once
	[ "$status" -eq 0 ]
	[[ "$output" == *"@x/thing has 2 ae-*/tsdoc-* diagnostics in"* ]]
	[[ "$output" != *"fails CI"* ]]
}

@test "ignores an uncoded warning and a non-API-Extractor code" {
	# An uncoded tsdown warning (the shape of a deprecation notice) and a
	# config finding are not the TSDoc pass's diagnostics.
	_issues true '[{"source":"tsdown","level":"warn","text":"The `emitDtsOnly` option is deprecated. Use `dtsOnly` instead."},{"source":"config","level":"warn","code":"exports-pattern-unmatched","text":"z"}]'
	_watch_once
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "silent when buildOk is false (crashed build)" {
	_issues false
	_watch_once
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "silent when buildOk is absent (unknown provenance)" {
	cat >"$PKG/dist/prod/issues.json" <<'EOF'
{"package":"@x/thing","target":"prod","warnings":[{"source":"api-extractor","level":"warn","code":"ae-forgotten-export","text":"Q"}],"errors":[]}
EOF
	_watch_once
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "silent on a zero-diagnostic artifact" {
	_issues true '[]'
	_watch_once
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "ignores dist/dev, which the kit's build never writes" {
	mkdir -p "$PKG/dist/dev"
	_issues true
	mv "$PKG/dist/prod/issues.json" "$PKG/dist/dev/issues.json"
	_watch_once
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "silent when a source file is newer than the artifact" {
	_issues true
	touch -t "$(date -v+2M +%Y%m%d%H%M.%S 2>/dev/null || date -d '+2 min' +%Y%m%d%H%M.%S)" "$PKG/src/index.ts"
	_watch_once
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "silent when a package effected.toml is newer than the artifact" {
	_issues true
	mkdir -p "$PKG/lib/configs"
	printf '[package.build]\n' >"$PKG/lib/configs/effected.toml"
	touch -t "$(date -v+2M +%Y%m%d%H%M.%S 2>/dev/null || date -d '+2 min' +%Y%m%d%H%M.%S)" "$PKG/lib/configs/effected.toml"
	_watch_once
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "silent when the workspace .config/effected.toml is newer than the artifact" {
	_issues true
	mkdir -p "$PROJECT/.config"
	printf '[package.build]\n' >"$PROJECT/.config/effected.toml"
	touch -t "$(date -v+2M +%Y%m%d%H%M.%S 2>/dev/null || date -d '+2 min' +%Y%m%d%H%M.%S)" "$PROJECT/.config/effected.toml"
	_watch_once
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "reports from a clean, committed tree" {
	_commit_all
	_issues true
	_watch_once
	[ "$status" -eq 0 ]
	[[ "$output" == *"@x/thing has 1 ae-*/tsdoc-* diagnostic"* ]]
}

@test "silent when the package has an uncommitted source" {
	_commit_all
	printf 'export const b = 2;\n' >"$PKG/src/dirty.ts"
	_issues true
	_watch_once
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "an uncommitted test file does not silence the monitor" {
	# Gate 3 is scoped to what feeds the ae-*/tsdoc-* pass. A dirty __test__/
	# file is the normal state during work and is not an input.
	_commit_all
	mkdir -p "$PKG/__test__"
	printf 'export const t = 1;\n' >"$PKG/__test__/thing.test.ts"
	_issues true
	_watch_once
	[ "$status" -eq 0 ]
	[[ "$output" == *"@x/thing has 1 ae-*/tsdoc-* diagnostic"* ]]
}

@test "an uncommitted package effected.toml silences the monitor, in each place the build reads one" {
	local rel
	for rel in effected.toml .config/effected.toml lib/configs/effected.toml; do
		rm -rf "$PROJECT/.git" "$PKG/.config" "$PKG/lib" "$PKG/effected.toml"
		_commit_all
		mkdir -p "$(dirname "$PKG/$rel")"
		printf '[package.build.meta.tsdoc]\n' >"$PKG/$rel"
		_issues true
		_watch_once
		[ "$status" -eq 0 ] || { echo "status $status for $rel" >&2; return 1; }
		[ -z "$output" ] || { echo "not silent for dirty $rel: $output" >&2; return 1; }
	done
}

@test "an uncommitted workspace effected.toml silences the monitor, in each place the build reads one" {
	local rel
	for rel in effected.toml .config/effected.toml; do
		rm -rf "$PROJECT/.git" "$PROJECT/.config" "$PROJECT/effected.toml"
		_commit_all
		mkdir -p "$(dirname "$PROJECT/$rel")"
		printf '[package.build]\n' >"$PROJECT/$rel"
		_issues true
		_watch_once
		[ "$status" -eq 0 ] || { echo "status $status for $rel" >&2; return 1; }
		[ -z "$output" ] || { echo "not silent for dirty root $rel: $output" >&2; return 1; }
	done
}

@test "an uncommitted effected.toml in another package does not silence this one" {
	mkdir -p "$PROJECT/packages/other"
	_commit_all
	printf '[package.build]\n' >"$PROJECT/packages/other/effected.toml"
	_issues true
	_watch_once
	[ "$status" -eq 0 ]
	[[ "$output" == *"@x/thing has 1 ae-*/tsdoc-* diagnostic"* ]]
}

@test "skips artifacts under node_modules and .repos" {
	local d
	# Each decoy is a package the freshness gate would vouch for (a source, an artifact newer than it), so only the
	# discovery exclusion keeps it quiet.
	for d in node_modules/@x/dep .repos/upstream/packages/p; do
		mkdir -p "$PROJECT/$d/dist/prod" "$PROJECT/$d/src"
		printf 'export const a = 1;\n' >"$PROJECT/$d/src/index.ts"
		_issues true
		cp -p "$PKG/dist/prod/issues.json" "$PROJECT/$d/dist/prod/issues.json"
	done
	rm "$PKG/dist/prod/issues.json"
	_watch_once
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

# --- debounce (savvy-web/systems#248) ----------------------------------------
#
# diagnose() is the pure step: a count must hold for minStablePolls scans
# before it fires, fires once per settled value, and a return to zero re-arms.

@test "diagnose fires only once a count settles, once per value, and re-arms at zero" {
	# Under -e, argv[1] is the first argument; the placeholder keeps it from naming the monitor, which would start it.
	run --separate-stderr node --input-type=module -e '
		const { diagnose } = await import(process.argv[2]);
		const yes = () => true, no = () => false;
		const c = (count) => [{ path: "/p/dist/prod/issues.json", pkgDir: "/p", pkg: "@x/p", count, ciFatal: 0, buildOk: true }];
		let prev = new Map();
		const seq = [3, 2, 2, 2, 2, 2, 0, 2, 2, 2];
		const fired = [];
		for (const n of seq) {
			const r = diagnose(c(n), prev, 2, no, yes);
			prev = r.next;
			fired.push(r.lines.length);
		}
		console.log(fired.join(""));
	' _ "$MONITOR"
	[ "$status" -eq 0 ]
	# 3 (streak 0), 2 (0), 2 (1), 2 (2: fires), 2, 2 (deduped), 0, 2 (0), 2 (1), 2 (2: fires again)
	[ "$output" = "0001000001" ]
}

@test "diagnose consults the freshness and clean-tree gates only for a candidate" {
	# Under -e, argv[1] is the first argument; the placeholder keeps it from naming the monitor, which would start it.
	run --separate-stderr node --input-type=module -e '
		const { diagnose } = await import(process.argv[2]);
		let calls = 0;
		const gate = () => { calls++; return true; };
		const one = (count) => [{ path: "/p/i.json", pkgDir: "/p", pkg: "@x/p", count, ciFatal: 0, buildOk: true }];
		diagnose(one(0), new Map(), 0, gate, gate);
		diagnose(one(4), new Map(), 3, gate, gate);
		const before = calls;
		diagnose(one(4), new Map(), 0, () => false, gate);
		console.log(before, calls);
	' _ "$MONITOR"
	[ "$status" -eq 0 ]
	[ "$output" = "0 1" ]
}

# --- resident mode -----------------------------------------------------------

@test "the stable-poll override is EFFECTED_BUILD_MONITOR_STABLE_POLLS" {
	_issues true
	run_monitor claude build-diagnostics --cwd "$PROJECT" --ticks 2 --timeout 15 EFFECTED_BUILD_MONITOR_STABLE_POLLS=1
	assert_hook_exit 0
	[[ "$output" == *"@x/thing has 1 ae-*/tsdoc-* diagnostic"* ]]
	# One line: the second tick fires, nothing repeats it.
	[ "$(printf '%s\n' "$output" | grep -c 'ae-\*/tsdoc-\*')" -eq 1 ]
}

@test "resident mode holds back a count that has not settled" {
	_issues true
	run_monitor claude build-diagnostics --cwd "$PROJECT" --ticks 2 --timeout 15 EFFECTED_BUILD_MONITOR_STABLE_POLLS=3
	assert_hook_exit 0
	[ -z "$output" ]
}

@test "a second resident monitor on the same project yields to the lock holder" {
	_issues true
	local out1="$BATS_TEST_TMPDIR/first.out" lockdir="$BATS_TEST_TMPDIR/tmp"
	mkdir -p "$lockdir"
	(cd "$PROJECT" && exec env -i PATH="$PATH" HOME="$HOME" XDG_STATE_HOME="$XDG_STATE_HOME" TMPDIR="$lockdir/" \
		EFFECTED_BUILD_MONITOR_STABLE_POLLS=0 node "$MONITOR" >"$out1" 2>&1) &
	local pid=$!
	local i
	for i in 1 2 3 4 5 6 7 8 9 10; do
		[ -n "$(find "$lockdir" -name 'effected-build-monitor-*.pid' -print -quit)" ] && break
		sleep 0.3
	done
	run --separate-stderr env -i PATH="$PATH" HOME="$HOME" XDG_STATE_HOME="$XDG_STATE_HOME" TMPDIR="$lockdir/" \
		EFFECTED_BUILD_MONITOR_STABLE_POLLS=0 bash -c 'cd "$1" && exec node "$2"' _ "$PROJECT" "$MONITOR"
	local second_status=$status second_output=$output
	kill "$pid" 2>/dev/null || true
	wait "$pid" 2>/dev/null || true
	[ "$second_status" -eq 0 ]
	[ -z "$second_output" ]
	grep -q "@x/thing has 1 ae-\*/tsdoc-\* diagnostic" "$out1"
	# The holder released its lock on SIGTERM.
	[ -z "$(find "$lockdir" -name 'effected-build-monitor-*.pid' -print -quit)" ]
}

@test "a lock whose heartbeat went quiet is reclaimed even when its pid is alive" {
	_issues true
	local lockdir="$BATS_TEST_TMPDIR/tmp" key lock
	mkdir -p "$lockdir"
	key=$(node -e 'const {createHash}=require("node:crypto");const {realpathSync}=require("node:fs");console.log(createHash("sha256").update(realpathSync(process.argv[1])).digest("hex").slice(0,16))' "$PROJECT")
	lock="$lockdir/effected-build-monitor-$key.pid"
	# A live pid (this shell) that never heartbeats: a recycled pid, in effect.
	printf '%s' "$$" >"$lock"
	touch -t "$(date -v-5M +%Y%m%d%H%M.%S 2>/dev/null || date -d '-5 min' +%Y%m%d%H%M.%S)" "$lock"
	run_monitor claude build-diagnostics --cwd "$PROJECT" --ticks 2 --timeout 15 TMPDIR="$lockdir/" EFFECTED_BUILD_MONITOR_STABLE_POLLS=1
	assert_hook_exit 0
	[[ "$output" == *"@x/thing has 1 ae-*/tsdoc-* diagnostic"* ]]
}

# _lock_path <lockdir> — the lock file a resident monitor on $PROJECT claims under <lockdir>.
_lock_path() {
	local key
	key=$(node -e 'const {createHash}=require("node:crypto");const {realpathSync}=require("node:fs");console.log(createHash("sha256").update(realpathSync(process.argv[1])).digest("hex").slice(0,16))' "$PROJECT")
	printf '%s/effected-build-monitor-%s.pid' "$1" "$key"
}

# _start_resident <lockdir> <out> — start a resident monitor in the background; sets RESIDENT_PID and waits for its
# lock to appear.
_start_resident() {
	(cd "$PROJECT" && exec env -i PATH="$PATH" HOME="$HOME" XDG_STATE_HOME="$XDG_STATE_HOME" TMPDIR="$1/" \
		EFFECTED_BUILD_MONITOR_STABLE_POLLS=0 node "$MONITOR" >"$2" 2>&1) &
	RESIDENT_PID=$!
	local i
	for i in $(seq 1 30); do
		[ -s "$(_lock_path "$1")" ] && return 0
		sleep 0.2
	done
	return 1
}

@test "a resident monitor whose lock a rival reclaimed stops reporting and leaves the rival's lock" {
	# The reclaim happens when the holder was suspended past STALE_LOCK_MS; rewriting the lock to name another live
	# pid, with a fresh mtime, is what the holder finds on resuming.
	_issues true
	local lockdir="$BATS_TEST_TMPDIR/tmp" out="$BATS_TEST_TMPDIR/holder.out" lock
	mkdir -p "$lockdir"
	lock=$(_lock_path "$lockdir")
	_start_resident "$lockdir" "$out"
	local i
	for i in $(seq 1 30); do
		grep -q "has 1 ae-" "$out" && break
		sleep 0.2
	done
	grep -q "@x/thing has 1 ae-\*/tsdoc-\* diagnostic" "$out"
	printf '%s' "$$" >"$lock"
	_issues true '[{"source":"api-extractor","level":"warn","code":"ae-missing-release-tag","text":"x"},{"source":"api-extractor","level":"warn","code":"tsdoc-code-span-empty","text":"y"}]'
	local exited=0
	for i in $(seq 1 40); do
		kill -0 "$RESIDENT_PID" 2>/dev/null || { exited=1; break; }
		sleep 0.2
	done
	kill "$RESIDENT_PID" 2>/dev/null || true
	wait "$RESIDENT_PID" 2>/dev/null || true
	[ "$exited" -eq 1 ]
	! grep -q "has 2 ae-" "$out"
	[ "$(cat "$lock")" = "$$" ]
}

@test "a resident monitor whose lock vanished claims it again and keeps watching" {
	_issues true
	local lockdir="$BATS_TEST_TMPDIR/tmp" out="$BATS_TEST_TMPDIR/holder.out" lock
	mkdir -p "$lockdir"
	lock=$(_lock_path "$lockdir")
	_start_resident "$lockdir" "$out"
	rm -f "$lock"
	local i reclaimed=0
	for i in $(seq 1 40); do
		[ "$(cat "$lock" 2>/dev/null)" = "$RESIDENT_PID" ] && { reclaimed=1; break; }
		sleep 0.2
	done
	local alive=0
	kill -0 "$RESIDENT_PID" 2>/dev/null && alive=1
	kill "$RESIDENT_PID" 2>/dev/null || true
	wait "$RESIDENT_PID" 2>/dev/null || true
	[ "$reclaimed" -eq 1 ]
	[ "$alive" -eq 1 ]
}

@test "runs unlocked and still reports when tmpdir is unwritable" {
	# The unlocked fallback is the path whose whole purpose is to keep the
	# monitor alive; --once never reaches it. Skip as root, where chmod 500
	# does not deny the write and the locked path runs instead.
	[ "$(id -u)" -ne 0 ] || skip "root ignores the directory mode"
	_issues true
	local rotmp="$BATS_TEST_TMPDIR/rotmp"
	mkdir -p "$rotmp"
	chmod 500 "$rotmp"
	run_monitor claude build-diagnostics --cwd "$PROJECT" --ticks 2 --timeout 15 TMPDIR="$rotmp/" EFFECTED_BUILD_MONITOR_STABLE_POLLS=1
	local listing
	listing=$(find "$rotmp" -mindepth 1 -print -quit)
	chmod 700 "$rotmp"
	assert_hook_exit 0
	[ -z "$listing" ]
	[[ "$output" == *"@x/thing has 1 ae-*/tsdoc-* diagnostic"* ]]
}

@test "logs an unreadable artifact through the plugin's error.log and keeps going" {
	printf '{not json' >"$PKG/dist/prod/issues.json"
	_watch_once PLUGINFINITY_PLUGIN=effected PLUGINFINITY_HOST=claude
	[ "$status" -eq 0 ]
	[ -z "$output" ]
	grep -q "monitor/build-diagnostics.mjs: .*packages/thing/dist/prod/issues.json" "$XDG_STATE_HOME/pluginfinity/effected/error.log"
}

@test "logs an unreadable artifact once per state, not once per poll" {
	printf '{not json' >"$PKG/dist/prod/issues.json"
	local log="$XDG_STATE_HOME/pluginfinity/effected/error.log"
	run_monitor claude build-diagnostics --cwd "$PROJECT" --ticks 3 --timeout 20 PLUGINFINITY_PLUGIN=effected PLUGINFINITY_HOST=claude
	assert_hook_exit 0
	[ "$(grep -c 'could not read packages/thing/dist/prod/issues.json' "$log")" -eq 1 ]
}

# --- registration ------------------------------------------------------------

@test "registered build-diagnostics command runs from monitors.json" {
	_issues true
	run_monitor claude build-diagnostics --cwd "$PROJECT"
	assert_hook_exit 0
	[[ "$output" == *"@x/thing has 1 ae-*/tsdoc-* diagnostic"* ]]
	[ -z "$stderr" ]
}

@test "the monitor finds its project from the git root when started in a subdirectory" {
	_commit_all
	_issues true
	run_monitor claude build-diagnostics --cwd "$PKG/src"
	assert_hook_exit 0
	[[ "$output" == *"in packages/thing/dist/prod/issues.json"* ]]
}

@test "copilot ships no monitor" {
	[ ! -e "$BUILDS/copilot/monitors" ]
	run_monitor copilot build-diagnostics
	[ "$status" -eq 1 ]
}
