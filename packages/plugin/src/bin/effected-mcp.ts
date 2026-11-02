#!/usr/bin/env node

/**
 * The `effected-mcp` bin, provided by the carrier.
 *
 * @packageDocumentation
 */

import { main } from "@effected/mcp/main";
import { PLUGIN_VERSION } from "../version.js";

await main({ distribution: { name: "@effected/plugin", version: PLUGIN_VERSION } });
