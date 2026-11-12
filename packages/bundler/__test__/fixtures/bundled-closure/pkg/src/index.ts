import { external } from "dep-external";
import { inlinedVersion, inlinedText, subpathVersion } from "dep-inlined";
import { deep } from "dep-inlined/deep";

/** This package's own version, which the build's `define` writes. */
export const ownVersion: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";

export { deep, external, inlinedText, inlinedVersion, subpathVersion };
