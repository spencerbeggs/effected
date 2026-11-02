#!/usr/bin/env bats
# launchers.bats — covers bin/start-mcp.sh as built for each host, on the
# pluginfinity server library. Each run is `sh <launcher>` under env -i from
# inside a fake project, with only what the host provides: PATH, HOME and the
# PLUGINFINITY_* keys the build puts in every server's env. Package-manager
# detection is the library's and is tested upstream; these tests pin the
# plugin's wiring: the bin it execs and the packages it names.

bats_require_minimum_version 1.5.0

BUILDS="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/builds"

setup() {
	FAKE_BIN="$BATS_TEST_TMPDIR/bin"
	mkdir -p "$BATS_TEST_TMPDIR/proj/.git" "$FAKE_BIN"
	# Physical: under env -i, sh derives $PWD without the /var symlink.
	PROJECT_DIR="$(cd "$BATS_TEST_TMPDIR/proj" && pwd -P)"
}

# _stub_runners — every package runner on PATH echoes its arguments, so an
# unstubbed real runner can never start a real server.
_stub_runners() {
	local r
	for r in pnpm yarn bun bunx npx; do
		cat >"$FAKE_BIN/$r" <<STUB
#!/bin/sh
printf '$r %s\n' "\$*"
STUB
		chmod +x "$FAKE_BIN/$r"
	done
}

_launch() {
	local host="$1"
	shift
	cd "$PROJECT_DIR"
	run --separate-stderr env -i PATH="$FAKE_BIN:/usr/bin:/bin" HOME="$BATS_TEST_TMPDIR/home" \
		PLUGINFINITY_HOST="$host" PLUGINFINITY_PLUGIN=effected PLUGINFINITY_LIB="$BUILDS/$host/lib/pluginfinity" \
		sh "$BUILDS/$host/bin/start-mcp.sh" "$@"
}

@test "both hosts' builds ship the launcher and the server library" {
	for host in claude copilot; do
		[ -f "$BUILDS/$host/bin/start-mcp.sh" ]
		[ -f "$BUILDS/$host/lib/pluginfinity/server.sh" ]
	done
}

@test "execs node_modules/.bin/effected-mcp with its args and nothing else on stdout" {
	mkdir -p "$PROJECT_DIR/node_modules/.bin"
	printf '#!/bin/sh\nprintf "effected-mcp %%s\\n" "$*"\n' >"$PROJECT_DIR/node_modules/.bin/effected-mcp"
	chmod +x "$PROJECT_DIR/node_modules/.bin/effected-mcp"
	_stub_runners
	for host in claude copilot; do
		_launch "$host" --stdio
		[ "$status" -eq 0 ]
		[ "$output" = "effected-mcp --stdio" ]
	done
}

@test "without the bin it names @effected/plugin on stderr and runs @effected/mcp" {
	_stub_runners
	for host in claude copilot; do
		_launch "$host" --stdio
		[ "$status" -eq 0 ]
		[[ "$stderr" == *"@effected/plugin"* ]]
		[ "$output" = "npx --yes @effected/mcp --stdio" ]
	done
}
