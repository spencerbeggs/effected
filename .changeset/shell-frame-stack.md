---
"@effected/shell": patch
---

## Performance

* `ShellSyntax.parse` keeps the nested scanner's frame stack in one typed array instead of seven JS arrays, so deeply nested input no longer feeds the garbage collector a live set that grows with every opener. A 2 MiB run of `((`, `(` or `$(` parses about 4× faster, and its cost now grows linearly with the input instead of super-linearly once the input passes 512 KiB
