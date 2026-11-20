import { Git } from "@effected/git";
import { Action } from "../../../../src/Action.js";
import { Checkout } from "../../../../src/Checkout.js";

await Action.run(Checkout.cleanup(), { layer: Git.layer });
