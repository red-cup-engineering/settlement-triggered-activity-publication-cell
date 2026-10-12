#!/usr/bin/env node
// project-successor-activation-records — write this cell's successor activation records.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { materializeSuccessorActivation } from "@red-cup-engineering/x402-exact-purchase-service/successor-activation-records";

import { settlementPulseCell } from "../src/successor-activation.mjs";

await materializeSuccessorActivation(settlementPulseCell, path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
