import { MemoryFileSystem } from "../src/index.js";
import { caseInsensitiveSuite } from "./CaseInsensitiveContract.js";

// SKIPPED until Task 9 (the case-folding engine): the engine does not yet
// consume `caseSensitive: false`, so this runner is red. Task 9 removes the
// skip; the host oracle (integration/case-insensitive.int.test.ts) is green.
caseInsensitiveSuite("memory", MemoryFileSystem.layerWith({}, { caseSensitive: false }), { skip: true });
