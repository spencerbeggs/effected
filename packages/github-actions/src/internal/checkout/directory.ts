import type { GitShape } from "@effected/git";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path } from "effect";

/**
 * What {@link prepareExistingDirectory} did with the directory.
 *
 * @internal
 */
export interface PreparedDirectory {
	/** Whether the repository already there was kept, rather than its contents deleted. */
	readonly reused: boolean;
	/** Whether a kept repository was cleaned (`clean -ffdx` and `reset --hard HEAD`). */
	readonly cleaned: boolean;
}

/**
 * Makes sure the checkout path is a directory, as checkout's `getSource` does
 * before anything else: a file at the path is deleted, a missing directory is
 * created. Answers whether a directory was already there.
 *
 * @internal
 */
export const ensureDirectory = (
	repositoryPath: string,
): Effect.Effect<boolean, PlatformError.PlatformError, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const info = yield* fs.stat(repositoryPath).pipe(Effect.option);
		if (Option.isSome(info) && info.value.type === "Directory") {
			return true;
		}
		if (Option.isSome(info)) {
			yield* fs.remove(repositoryPath, { recursive: true, force: true });
		}
		yield* fs.makeDirectory(repositoryPath, { recursive: true });
		return false;
	});

/** Deletes everything inside `directory`, never the directory itself: it may be the working directory. */
const emptyDirectory = (
	directory: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		yield* Effect.logInfo(`Deleting the contents of '${directory}'`);
		for (const entry of yield* fs.readDirectory(directory)) {
			yield* fs.remove(path.join(directory, entry), { recursive: true, force: true });
		}
	});

/**
 * The remote-tracking branches under `origin` that conflict with `ref`: one
 * whose name is a path prefix of the ref's branch, or that has it as one
 * (`foo` against `foo/bar`), compared case-insensitively as checkout does.
 */
const conflictingRemoteBranches = (ref: string, remoteBranches: ReadonlyArray<string>): ReadonlyArray<string> => {
	if (!ref) return [];
	const qualified = ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
	if (!qualified.startsWith("refs/heads/")) return [];
	const name1 = qualified.toUpperCase().substring("REFS/HEADS/".length);
	return remoteBranches.filter((branch) => {
		const name2 = branch.substring("origin/".length).toUpperCase();
		return name1.startsWith(`${name2}/`) || name2.startsWith(`${name1}/`);
	});
};

/**
 * Readies an existing directory for a checkout, as checkout's
 * `prepareExistingDirectory` does.
 *
 * @remarks
 * A repository whose `remote.origin.url` is `repositoryUrl` is kept: the
 * `index.lock` and `shallow.lock` a cancelled run left are deleted, `HEAD` is
 * detached, every local branch is deleted, and so is every `origin`
 * remote-tracking branch that conflicts with `ref`. When its submodules cannot
 * be listed, or (with `clean`) `clean -ffdx` or `reset --hard HEAD` fails, or
 * any of these steps fails, a warning is logged and it is not kept. A
 * directory that is not kept has its contents deleted, never the directory
 * itself.
 *
 * @internal
 */
export const prepareExistingDirectory = (
	git: GitShape,
	repositoryPath: string,
	repositoryUrl: string,
	clean: boolean,
	ref: string,
): Effect.Effect<PreparedDirectory, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const gitDir = path.join(repositoryPath, ".git");

		const hasGitDir = yield* fs.exists(gitDir).pipe(Effect.orElseSucceed(() => false));
		const fetchUrl = hasGitDir
			? yield* git
					.configGet(repositoryPath, "remote.origin.url", { scope: "local" })
					.pipe(Effect.orElseSucceed(() => Option.none<string>()))
			: Option.none<string>();

		let remove = !(Option.isSome(fetchUrl) && fetchUrl.value === repositoryUrl);
		let cleaned = false;

		if (!remove) {
			for (const lock of [path.join(gitDir, "index.lock"), path.join(gitDir, "shallow.lock")]) {
				yield* fs
					.remove(lock, { force: true })
					.pipe(Effect.catch((error) => Effect.logDebug(`Unable to delete '${lock}'. ${error.message}`)));
			}

			const reuse = Effect.gen(function* () {
				yield* Effect.logInfo("Removing previously created refs, to avoid conflicts");
				if (Option.isSome(yield* git.currentBranch(repositoryPath))) {
					yield* git.checkout(repositoryPath, "HEAD", { detach: true });
				}
				// A detached HEAD lists as "(HEAD detached at …)", which names no branch.
				for (const branch of yield* git.branchList(repositoryPath)) {
					if (branch.name.startsWith("(")) continue;
					yield* git.branchDelete(repositoryPath, branch.name, { force: true });
				}
				const remoteBranches = (yield* git.branchList(repositoryPath, { remotes: true }))
					.map((branch) => branch.name)
					.filter((name) => name.startsWith("origin/"));
				for (const branch of conflictingRemoteBranches(ref, remoteBranches)) {
					yield* git.branchDelete(repositoryPath, branch, { force: true, remote: true });
				}

				// Submodules git cannot list mean a working tree it cannot clean.
				const submodulesOk = yield* git.submoduleStatus(repositoryPath).pipe(
					Effect.as(true),
					Effect.orElseSucceed(() => false),
				);
				if (!submodulesOk) {
					yield* Effect.logInfo("Bad Submodules found, removing existing files");
					return false;
				}

				if (clean) {
					yield* Effect.logInfo("Cleaning the repository");
					const restored = yield* git.clean(repositoryPath, { nested: true, directories: true, ignored: true }).pipe(
						Effect.andThen(git.reset(repositoryPath, { mode: "hard", ref: "HEAD" })),
						Effect.as(true),
						Effect.catch((error) =>
							Effect.as(
								Effect.logDebug(
									`The clean command failed. This might be caused by: 1) path too long, 2) permission issue, or 3) file in use. For further investigation, manually run 'git clean -ffdx' on the directory '${repositoryPath}'. ${error.message}`,
								),
								false,
							),
						),
					);
					if (!restored) {
						yield* Effect.logWarning(
							"Unable to clean or reset the repository. The repository will be recreated instead.",
						);
						return false;
					}
					cleaned = true;
				}
				return true;
			});

			const kept = yield* reuse.pipe(
				Effect.catch(() =>
					Effect.as(
						Effect.logWarning("Unable to prepare the existing repository. The repository will be recreated instead."),
						false,
					),
				),
			);
			remove = !kept;
		}

		if (remove) {
			yield* emptyDirectory(repositoryPath);
			return { reused: false, cleaned: false };
		}
		return { reused: true, cleaned };
	});
