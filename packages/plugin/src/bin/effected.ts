#!/usr/bin/env node

/**
 * The `effected` bin, provided by the carrier.
 *
 * @packageDocumentation
 */

import { main } from "@effected/cli/main";
import { PLUGIN_VERSION } from "../version.js";

main({ distribution: { name: "@effected/plugin", version: PLUGIN_VERSION } });
