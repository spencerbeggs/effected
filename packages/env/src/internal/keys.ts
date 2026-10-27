import { agentKeys } from "./agentCi.js";
import { ciDetectKeys } from "./ci.js";
import { colorKeys } from "./colorDepth.js";
import { terminalKeys } from "./osc8/detect.js";
import { sessionKeys } from "./session.js";

/**
 * The variables a `RuntimeEnv` snapshot reads up front: the agent, CI detection, session and terminal key lists,
 * without duplicates. The matched CI provider's run coordinates are read after, by `ciCoordinateKeys`.
 *
 * @internal
 */
export const runtimeKeys: ReadonlyArray<string> = [
	...new Set([...agentKeys, ...ciDetectKeys, ...sessionKeys, ...terminalKeys]),
];

/**
 * The variables `TerminalEnv` reads: the colour and terminal detectors' keys and `COLUMNS`, without duplicates.
 *
 * @internal
 */
export const terminalEnvKeys: ReadonlyArray<string> = [...new Set([...colorKeys, ...terminalKeys, "COLUMNS"])];
