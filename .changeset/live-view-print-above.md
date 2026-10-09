---
"@effected/cli": minor
---

## Features

* `LiveHandle` gains `printAbove(stream, line)`, for a host that forwards output it did not write itself (a child process's stderr, a test runner's captured streams) and must know where it went. It prints `line` and a line break above the mounted live frame, through Ink's writer for `"stdout"` or `"stderr"`, and returns `true`; when no frame is mounted (between runs, after `close`, or a view that never mounts because the run is not interactive) it writes nothing and returns `false`, so the caller can send the line elsewhere. The check and the write are one synchronous step, so a frame cannot unmount between them (Ink still drops the line while a render has suspended the terminal). Unlike `logConsole`, it leaves the no-frame case to the caller.
* `CliUiTestLive` in `@effected/cli/ui/testing` gains `write(stream, bytes)`, which writes bytes straight to the fake terminal's stdout or stderr past Ink and the view, reproducing a child process or another library tearing a mounted frame. It also gains `stdoutWritten` and `stderrWritten`, the bytes written to each stream alone, to assert which stream a line landed on.

```ts
const routed = handle.printAbove("stderr", "build: compiling");
if (!routed) {
	// no frame is mounted; write it somewhere else
}
```
