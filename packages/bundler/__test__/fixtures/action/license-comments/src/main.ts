// Imports a bundled dependency that carries a license banner. Minifiers extract
// such `/*! */` banners to `main.js.LICENSE.txt` by default — noise for a
// committed action (issue #94). See vendor/banner-dep.cjs.
import { greeting } from "../vendor/banner-dep.cjs";

process.stdout.write(`${greeting}\n`);
