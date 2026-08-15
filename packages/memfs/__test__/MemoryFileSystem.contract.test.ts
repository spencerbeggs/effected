// The vendored FileSystem contract suite (see FileSystemContract.ts for the
// port header) run against the in-memory volume. The same suite runs against
// the real filesystem in integration/node.int.test.ts — memory and disk
// passing one suite is the differential proof the port matches real semantics
// on the installed beta.

import { MemoryFileSystem } from "../src/index.js";
import { suite } from "./FileSystemContract.js";

suite("memory", MemoryFileSystem.layer);
