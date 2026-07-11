/**
 * Mock Zod type definitions for testing
 */

export interface ZodType<Output = unknown, Def extends ZodTypeDef = ZodTypeDef, Input = Output> {
	_type: Output;
	_def: Def;
	_input: Input;
}

export interface ZodTypeDef {
	typeName: string;
}

export declare const z: {
	string(): ZodType<string>;
	number(): ZodType<number>;
	boolean(): ZodType<boolean>;
	object<T extends Record<string, ZodType>>(shape: T): ZodType<{ [K in keyof T]: T[K]["_type"] }>;
};
