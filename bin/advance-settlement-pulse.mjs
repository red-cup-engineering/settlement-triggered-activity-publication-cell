#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { advanceWithHiredProviders, createPulseHistory } from "../src/runtime.mjs";

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value;
}

async function readDemand(argv) {
  if (argv[0] !== undefined) {
    return JSON.parse(await readFile(path.resolve(argv[0]), "utf8"));
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  if (chunks.length === 0) throw new TypeError("supply one demand JSON file or JSON on standard input");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function main(argv = process.argv.slice(2)) {
  const demand = await readDemand(argv);
  const history = createPulseHistory({
    root: requiredEnvironment("RWIL_DATA_ROOT"),
    agentUrl: requiredEnvironment("RWIL_RDF_AGENT"),
    nodeId: "settlement-triggered-activity-publication-cell",
    actor: "urn:ame:settlement-triggered-activity-publication-cell",
    settlement: requiredEnvironment("SETTLEMENT_ACCOUNT"),
  });
  const result = await advanceWithHiredProviders(demand, {
    expectedChain: requiredEnvironment("SETTLEMENT_CAIP2"),
    history,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
