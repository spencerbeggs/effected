import { Readable } from "node:stream";

// Imports a bundled CommonJS dependency that uses the __importDefault interop
// helper against a node: builtin. See vendor/legacy-cjs-dep.cjs and issue #79.
import { isStream } from "../vendor/legacy-cjs-dep.cjs";

const readable = Readable.from(["integration"]);
process.stdout.write(`isStream=${isStream(readable)}\n`);
