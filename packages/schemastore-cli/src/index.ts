/**
 * The `schemastore` command's library surface: the one shipped
 * `SchemaValidator` engine, for a program that drives
 * `@effected/schemastore`'s `SchemaPipeline` itself and wants the same
 * verdict the command gives. The command is the canonical way to use the
 * kit's schemastore support; this export exists so nothing is hidden from a
 * consumer with a reason to compose the layers differently.
 *
 * @packageDocumentation
 */

export { AjvValidator } from "./AjvValidator.js";
