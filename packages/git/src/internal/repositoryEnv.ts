/**
 * The environment variables that point git at one particular repository,
 * as `git rev-parse --local-env-vars` lists them.
 *
 * @remarks
 * This is git's own list (`local_repo_env` in git's `environment.c`): the
 * variables git clears itself before it runs a command against a different
 * repository, such as a submodule. git exports several of them to a hook
 * (`GIT_DIR`, `GIT_INDEX_FILE` and `GIT_PREFIX`, probed against git 2.56 in a
 * linked worktree's `pre-commit`), and a child git that inherits them
 * answers for the hook's repository instead of the `cwd` it was spawned in.
 * The integration suite compares this list with the installed git's answer,
 * so a git release that adds a variable fails a test instead of passing
 * silently.
 *
 * @internal
 */
export const REPOSITORY_ENV_VARS: ReadonlyArray<string> = [
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_CONFIG",
	"GIT_CONFIG_PARAMETERS",
	"GIT_CONFIG_COUNT",
	"GIT_OBJECT_DIRECTORY",
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_IMPLICIT_WORK_TREE",
	"GIT_GRAFT_FILE",
	"GIT_INDEX_FILE",
	"GIT_NO_REPLACE_OBJECTS",
	"GIT_REPLACE_REF_BASE",
	"GIT_PREFIX",
	"GIT_SHALLOW_FILE",
	"GIT_COMMON_DIR",
];
