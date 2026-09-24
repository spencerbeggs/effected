// Lets `node` run this package's TypeScript sources directly: Node strips the
// types itself, and this hook maps a relative `./x.js` import to the `./x.ts`
// source when no `.js` file exists.
import { registerHooks } from "node:module";

registerHooks({
	resolve(specifier, context, next) {
		try {
			return next(specifier, context);
		} catch (error) {
			if (error?.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && specifier.endsWith(".js")) {
				return next(`${specifier.slice(0, -3)}.ts`, context);
			}
			throw error;
		}
	},
});
