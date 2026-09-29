---
"@effected/claude-code-plugin": patch
---

## Documentation

* The effect-v4-testing fault-injection and false-greens references and the effected-packages memfs reference now cover `MemoryFileSystem.die` and the `(base) => faults` factory form.
* The effected-packages walker and git references cover `Walker.ascendWithin` and `Git.commonDir`, and warn that `ascend`'s lexical `stopAt` never matches `Git.repoRoot`'s symlink-resolved answer.
