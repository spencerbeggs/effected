import { agentKeys } from "./agentCi.js";
import { ciKeys } from "./ci.js";
import { colorKeys } from "./colorDepth.js";
import { terminalKeys } from "./osc8/detect.js";
import { sessionKeys } from "./session.js";

/**
 * Every environment variable any detector reads: the union of the agent, CI, session, colour and terminal key lists,
 * without duplicates.
 *
 * @internal
 */
export const allKeys: ReadonlyArray<string> = [
	...new Set([...agentKeys, ...ciKeys, ...sessionKeys, ...colorKeys, ...terminalKeys]),
];
