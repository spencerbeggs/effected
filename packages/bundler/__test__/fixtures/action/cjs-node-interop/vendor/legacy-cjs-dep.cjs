"use strict";
// Hand-authored CommonJS module that reproduces the TypeScript-emitted interop
// pattern shipped by packages such as minipass (dist/commonjs/index.js):
//
//   const node_stream_1 = __importDefault(require("node:stream"));
//   ... value instanceof node_stream_1.default
//
// When the builder externalizes `node:stream` with ESM ("module") semantics,
// require("node:stream") resolves to a namespace object, __importDefault wraps
// it as { default: <namespace> }, and `instanceof` throws at runtime:
//   TypeError: Right-hand side of 'instanceof' is not callable
// See issue #79.
var __importDefault =
	(this && this.__importDefault) ||
	function (mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStream = void 0;
const node_stream_1 = __importDefault(require("node:stream"));
const isStream = (value) => value instanceof node_stream_1.default;
exports.isStream = isStream;
