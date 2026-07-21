---
"@effected/tsconfig-json": minor
---

## Features

### `TsEnumCodec.encodeCompilerOptions` returns `ProgrammaticCompilerOptions`

`encodeCompilerOptions` returned `Record<string, unknown>`, so a consumer
handing the result to a `ts.CompilerOptions`-shaped API (`@typescript/vfs`,
the TypeScript compiler API) had to cast. It now returns the new exported
`ProgrammaticCompilerOptions` type (values `ProgrammaticCompilerOptionsValue`)
— a structural transcription of TypeScript's own `CompilerOptionsValue`,
verified assignable to the real `ts.CompilerOptions` without importing
`typescript`, preserving the package's zero-`typescript`-import rule:

```ts
import { TsEnumCodec } from "@effected/tsconfig-json";
import { createVirtualTypeScriptEnvironment } from "@typescript/vfs";

const compilerOptions = TsEnumCodec.encodeCompilerOptions(decoded);
// no cast needed — assignable to ts.CompilerOptions
createVirtualTypeScriptEnvironment(fsMap, rootFiles, system, compilerOptions);
```

Runtime behavior is unchanged; only the declared return type narrows.
