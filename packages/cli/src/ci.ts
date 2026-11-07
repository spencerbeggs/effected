/**
 * Whether the process runs under CI, by `@effected/env`'s one rule: a known
 * provider's marker, or a truthy `CI` or `CONTINUOUS_INTEGRATION`; `CI=false`
 * is not CI. Its own module so `main` and its test call the same expression,
 * and so `main` never reaches `@effected/engine/build`, which loads the
 * bundler and its toolchain.
 *
 * @internal
 */

import { RuntimeEnv } from "@effected/env";
import { Option } from "effect";

export const isCI = (env: Readonly<Record<string, string | undefined>>): boolean =>
	Option.isSome(RuntimeEnv.fromRecord(env).ci);
