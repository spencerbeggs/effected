import { randomUUID } from "node:crypto";

// "uninstalled-peer-dep" is deliberately NOT present in node_modules. The build
// can only succeed if the configured string external is honored — otherwise
// rspack hard-fails with "Module not found". See issue #81.
import "uninstalled-peer-dep";

process.stdout.write(`id=${randomUUID()}\n`);
