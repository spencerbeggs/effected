import { Schema } from "effect";

export const BasicConfig = Schema.Struct({ name: Schema.String }).annotate({ description: "A basic fixture config" });
