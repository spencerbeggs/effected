import { build } from "@savvy-web/bundler";

// Bin-only package: nothing is exported for consumers to import, so there are
// no declarations to bundle and no API model to extract. `emitDts: false` skips
// both passes (the prod meta pass refuses a package with zero entry points).
await build({ emitDts: false });
