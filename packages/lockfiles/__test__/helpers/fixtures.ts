import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The suffix every lockfile fixture carries on disk.
 *
 * GitHub's dependency graph treats any file named exactly `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` or
 * `bun.lock` as a real manifest wherever it sits, so a fixture of real package-manager output under its real name
 * raises a Dependabot alert for every advisory against a package it pins. Dependabot's `exclude-paths` does not reach
 * the dependency graph, and dismissing an alert does not stop the next one. Stored as `pnpm-lock.yaml.fixture`, the
 * file is no manifest, and its bytes stay exactly what the package manager wrote: no formatter matches the suffix.
 */
export const FIXTURE_SUFFIX = ".fixture";

/** The fixtures directory. */
export const FIXTURES_DIR = join(import.meta.dirname, "..", "fixtures");

/** The on-disk path of a fixture named by its logical path, such as `pnpm/v2/pnpm-lock.yaml`. */
export const fixturePath = (relative: string): string => join(FIXTURES_DIR, `${relative}${FIXTURE_SUFFIX}`);

/** A fixture's text, named by its logical path, such as `pnpm/v2/pnpm-lock.yaml`. */
export const fixture = (relative: string): string => readFileSync(fixturePath(relative), "utf8");
