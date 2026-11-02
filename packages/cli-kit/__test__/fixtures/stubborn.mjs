// A bin that ignores SIGTERM, for CliTest.spawn's forced kill: it prints its pid, then runs until SIGKILL.
process.on("SIGTERM", () => process.stdout.write("ignored SIGTERM\n"));
setInterval(() => {}, 1000);
process.stdout.write(`${process.pid}\n`);
