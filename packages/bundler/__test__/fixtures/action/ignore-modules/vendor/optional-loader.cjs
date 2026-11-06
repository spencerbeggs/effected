"use strict";
// Mirrors the optional-dependency pattern used by packages such as cyclonedx:
// an optional native module is required inside a try/catch, so an absent
// module is treated as "feature unavailable" rather than crashing the action.
// "excluded-native-dep" is intentionally NOT present in node_modules.
Object.defineProperty(exports, "__esModule", { value: true });
let available;
try {
	require("excluded-native-dep");
	available = true;
} catch {
	available = false;
}
exports.xmlAvailable = available;
