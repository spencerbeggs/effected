---
id: "0018"
title: ChildProcess.make templates reject shell syntax at run time
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.0"
detect: ["ChildProcess\\.make", "shell: *true"]
---

A `ChildProcess.make` template with shell syntax in its literal text fails at run time with a `CommandLineError` (`UnsupportedSyntax`). `|`, `$HOME`, `*` and an assignment prefix such as `FOO+=bar cmd` are rejected rather than passed through. Quote such characters, or pass them as `${}` values. With `shell`, a template cannot hold `${}` values; build the script with `CommandLine.join` instead.

How it shows itself: the command compiles and fails when it runs. Only tests find it, so read every template the detect hits name: the kit had none to probe.
