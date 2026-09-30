import { agentCiKeys } from "./agentCi.js";
import { colorKeys } from "./colorDepth.js";
import { terminalKeys } from "./osc8/detect.js";

/**
 * Every environment variable any detector reads: the union of the agent/CI, colour and terminal key lists, without
 * duplicates.
 *
 * @internal
 */
export const allKeys: ReadonlyArray<string> = [...new Set([...agentCiKeys, ...colorKeys, ...terminalKeys])];
