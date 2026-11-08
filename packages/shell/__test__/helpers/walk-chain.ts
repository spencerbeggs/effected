// Run by ShellScript.test.ts in a child `node --stack-size=200`: walk a chain
// of `$(` as deep as argv[2] with no depth cap and print how many scripts the
// walk built. An iterative walk finishes; one that recursed per depth would
// throw a RangeError on this stack.

import { ShellSyntax } from "../../src/index.js";

const depth = Number(process.argv[2]);
const input = `echo ${"$(".repeat(depth)}c${")".repeat(depth)}`;
const walk = ShellSyntax.parse(input).allCommands({ maxDepth: Number.POSITIVE_INFINITY });
process.stdout.write(`${walk.scripts.length} ${walk.truncated}\n`);
