---
"@effected/tsconfig-json": minor
---

## Features

### Decoding `compilerOptions` from TypeScript's programmatic spelling

`CompilerOptionsFromProgrammatic` is a codec between the shape TypeScript's own API uses — `{ target: ts.ScriptTarget.ES2025 }`, a live `ts.CompilerOptions`, or the output of `TsEnumCodec.encodeCompilerOptions` — and this package's decoded `CompilerOptions.Type`.

`encodeCompilerOptions` already provided a typed way *out* to the numeric-enum spelling. There was no typed way *in*, so a caller holding that spelling had to cast into the encoder.

```ts
import { Schema } from "effect";
import { CompilerOptionsFromProgrammatic } from "@effected/tsconfig-json";

// { target: "es2025", strict: true, lib: ["esnext"] }
Schema.decodeUnknownSync(CompilerOptionsFromProgrammatic)({
	target: 12,
	strict: true,
	lib: ["lib.esnext.d.ts"],
});
```

Decoding accepts numeric enum values, canonical strings, case-varying strings (`"ESNext"`), any mixture of the three in one object, and `lib` entries in any of their three spellings. It is idempotent on already-canonical input, and unknown keys pass through as they do everywhere else in this package. Encoding produces the programmatic form.

A numeric value with no table entry — a future TypeScript enum member — **fails decode** as a typed schema error rather than passing through. That is the difference between this codec and `TsEnumCodec.decodeCompilerOptions`, which passes such a value through and keeps its open return type for exactly that reason: pass-through is correct in the low-level data codec, rejection is correct at a boundary that promises `CompilerOptions.Type`.

`ProgrammaticRecord`, the codec's encoded type, is exported alongside it.

Nothing existing changed — this release is additive.
