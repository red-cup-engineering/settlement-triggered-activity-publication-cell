#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  decodeSemantic,
  semanticBytes,
} from "@red-cup-engineering/rmn-semantic-conformance";
import {
  decodeRelationalValue,
} from "@red-cup-engineering/rmn-semantic-conformance/relational-value";
import { relationalRwilDocument } from "@lenticule-science/rwil-rdf-projection-service/client";
import { advanceWithHiredProviders, createPulseHistory } from "./runtime.mjs";

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value;
}

function requestBytes(message) {
  const candidates = (Array.isArray(message?.parts) ? message.parts : [])
    .filter((part) => part?.mediaType === "application/rmn+cbor" && typeof part?.raw === "string");
  if (candidates.length !== 1) {
    throw new TypeError("A2A request requires exactly one application/rmn+cbor raw part");
  }
  const bytes = Buffer.from(candidates[0].raw, "base64");
  const ni = `ni:///sha-256;${createHash("sha256").update(bytes).digest("base64url")}`;
  if (bytes.length === 0 || bytes.toString("base64") !== candidates[0].raw
      || candidates[0].metadata?.ni !== ni) {
    throw new TypeError("A2A request RMN bytes or identity are not canonical");
  }
  return bytes;
}

function demandFromMessage(message) {
  const ascribed = decodeSemantic(requestBytes(message));
  if (ascribed?.[0] !== "ascribe" || ascribed.length !== 3) {
    throw new TypeError("A2A demand must be one explicitly typed RMN value");
  }
  return decodeRelationalValue(ascribed[1], ascribed[2]);
}

export async function executeMessage(message) {
  const history = createPulseHistory({
    root: requiredEnvironment("RWIL_DATA_ROOT"),
    agentUrl: requiredEnvironment("RWIL_RDF_AGENT"),
    nodeId: "settlement-triggered-activity-publication-cell",
    actor: "urn:ame:settlement-triggered-activity-publication-cell",
    settlement: requiredEnvironment("SETTLEMENT_ACCOUNT"),
  });
  const result = await advanceWithHiredProviders(demandFromMessage(message), {
    expectedChain: requiredEnvironment("SETTLEMENT_CAIP2"),
    history,
  });
  const bytes = semanticBytes(relationalRwilDocument(result));
  const ni = `ni:///sha-256;${createHash("sha256").update(bytes).digest("base64url")}`;
  return {
    messageId: randomUUID(),
    role: "ROLE_AGENT",
    parts: [{
      raw: bytes.toString("base64"),
      metadata: { ni },
      filename: "settlement-pulse-result.rmn.cbor",
      mediaType: "application/rmn+cbor",
    }],
    metadata: {
      operation: "advance-settlement-pulse",
      chain: requiredEnvironment("SETTLEMENT_CAIP2"),
    },
  };
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  process.stdout.write(`${JSON.stringify(await executeMessage(message))}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
