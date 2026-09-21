import { assert, describe, it } from "@effect/vitest";
import { tarExtractCommand, unzipCommand, zipCommand } from "../src/internal/archiveCommands.js";

/**
 * The archiver command lines, pinned verbatim.
 *
 * @remarks
 * These are the ONE spelling of each archiver invocation the package makes,
 * shared by `Artifact` and `ToolInstaller`. The Windows halves cannot be
 * executed from a POSIX host, so their text is the contract under test —
 * in particular the three-argument `ExtractToDirectory(src, dest, $true)`
 * overload (the two-argument one refuses to overwrite, which is how a second
 * extraction into a populated directory failed with an EMPTY stderr) and the
 * try/catch that writes the .NET exception to stderr and exits 1.
 */
describe("archiveCommands", () => {
	const PWSH_FLAGS = ["-NoProfile", "-NonInteractive", "-Command"];

	describe("zipCommand", () => {
		it("POSIX: `zip -<level> -qr <destination> <files...>` from the root as cwd", () => {
			const command = zipCommand({
				windows: false,
				root: "/work/root",
				files: ["a.txt", "dir/b.txt"],
				destination: "/tmp/scratch/artifact.zip",
				level: 6,
			});
			assert.strictEqual(command.command, "zip");
			assert.deepStrictEqual([...command.args], ["-6", "-qr", "/tmp/scratch/artifact.zip", "a.txt", "dir/b.txt"]);
			assert.strictEqual(command.options.cwd, "/work/root");
		});

		it("POSIX: the compression level is clamped to zip's 0..9 and truncated", () => {
			const level = (value: number) =>
				zipCommand({ windows: false, root: "/r", files: ["f"], destination: "/d.zip", level: value }).args[0];
			assert.strictEqual(level(12), "-9");
			assert.strictEqual(level(-3), "-0");
			assert.strictEqual(level(4.9), "-4");
		});

		it("Windows: `Compress-Archive -Force` over the quoted relative paths, from the root as cwd", () => {
			const command = zipCommand({
				windows: true,
				root: "D:\\a\\root",
				files: ["a.txt", "dir\\b.txt"],
				destination: "D:\\a\\_temp\\artifact.zip",
				level: 6,
			});
			assert.strictEqual(command.command, "pwsh");
			assert.deepStrictEqual(
				[...command.args],
				[
					...PWSH_FLAGS,
					"Compress-Archive -Path 'a.txt','dir\\b.txt' -DestinationPath 'D:\\a\\_temp\\artifact.zip' -Force",
				],
			);
			assert.strictEqual(command.options.cwd, "D:\\a\\root");
		});

		it("Windows: a single quote in a path is doubled, the PowerShell single-quote escape", () => {
			const command = zipCommand({
				windows: true,
				root: "D:\\r",
				files: ["it's.txt"],
				destination: "D:\\o'brien\\a.zip",
				level: 6,
			});
			assert.strictEqual(
				command.args[3],
				"Compress-Archive -Path 'it''s.txt' -DestinationPath 'D:\\o''brien\\a.zip' -Force",
			);
		});
	});

	describe("unzipCommand", () => {
		it("POSIX: `unzip -oq <source> -d <destination>` — `-o` overwrites", () => {
			const command = unzipCommand({ windows: false, source: "/tmp/a.zip", destination: "/tmp/out" });
			assert.strictEqual(command.command, "unzip");
			assert.deepStrictEqual([...command.args], ["-oq", "/tmp/a.zip", "-d", "/tmp/out"]);
			assert.isUndefined(command.options.cwd);
		});

		it("Windows: the THREE-argument ExtractToDirectory overload under Stop + try/catch, quoted", () => {
			const command = unzipCommand({ windows: true, source: "D:\\a.zip", destination: "D:\\out" });
			assert.strictEqual(command.command, "pwsh");
			assert.deepStrictEqual(
				[...command.args],
				[
					...PWSH_FLAGS,
					"$ErrorActionPreference = 'Stop'; try { Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
						"[System.IO.Compression.ZipFile]::ExtractToDirectory('D:\\a.zip', 'D:\\out', $true) } " +
						"catch { [Console]::Error.WriteLine($_.Exception.ToString()); exit 1 }",
				],
			);
		});

		it("Windows: the overwrite overload is the mutant that shipped — `$true` must be present", () => {
			// The two-argument form typechecks in PowerShell just as well and
			// refuses to overwrite; the assertion above pins the whole string, this
			// one names the load-bearing token so a rewrite cannot lose it quietly.
			const command = unzipCommand({ windows: true, source: "a.zip", destination: "out" });
			assert.include(command.args[3], "ExtractToDirectory('a.zip', 'out', $true)");
		});

		it("Windows: single quotes in either path are doubled", () => {
			const command = unzipCommand({ windows: true, source: "D:\\it's.zip", destination: "D:\\o'brien" });
			assert.include(command.args[3], "ExtractToDirectory('D:\\it''s.zip', 'D:\\o''brien', $true)");
		});
	});

	describe("tarExtractCommand", () => {
		it("defaults the flags to `xzf` and lands in `-C <destination>`", () => {
			const command = tarExtractCommand({ archive: "/tmp/tool.tgz", destination: "/tmp/out" });
			assert.strictEqual(command.command, "tar");
			assert.deepStrictEqual([...command.args], ["xzf", "/tmp/tool.tgz", "-C", "/tmp/out"]);
		});

		it("an empty flag list is the default, not a flagless tar", () => {
			const command = tarExtractCommand({ archive: "a.tgz", destination: "out", flags: [] });
			assert.deepStrictEqual([...command.args], ["xzf", "a.tgz", "-C", "out"]);
		});

		it("supplied flags replace the default verbatim", () => {
			const command = tarExtractCommand({
				archive: "a.tar.xz",
				destination: "out",
				flags: ["xJf", "--strip-components=1"],
			});
			assert.deepStrictEqual([...command.args], ["xJf", "--strip-components=1", "a.tar.xz", "-C", "out"]);
		});
	});
});
