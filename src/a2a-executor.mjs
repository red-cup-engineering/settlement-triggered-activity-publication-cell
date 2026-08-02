#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { rawNiUri } from "@red-cup-engineering/relation-model-notation-runtime/canonical-cbor";
import {
  decodeSemantic,
  semanticBytes,
} from "@red-cup-engineering/relation-model-notation-runtime";
import {
  decodeRelationalValue,
} from "@red-cup-engineering/relation-model-notation-runtime/relational-value";
import { relationalWitnessJournalDocument } from "@red-cup-engineering/witness-journal-rdf-projection-service/client";
import { advanceWithHiredProviders, createPulseHistory } from "./runtime.mjs";
import { loadSuccessorAccountBinding } from "./successor-deployment.mjs";

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
  const ni = rawNiUri(bytes);
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
  const active = await loadSuccessorAccountBinding({
    manifestPath: requiredEnvironment("EVM_DEPLOYMENT_MANIFEST"),
    accountBindingPath: process.env.SETTLEMENT_ACCOUNT_BINDING,
    nodeId: "settlement-triggered-activity-publication-cell",
  });
  const history = createPulseHistory({
    root: requiredEnvironment("WITNESS_JOURNAL_DATA_ROOT"),
    agentUrl: requiredEnvironment("WITNESS_JOURNAL_RDF_AGENT"),
    nodeId: "settlement-triggered-activity-publication-cell",
    actor: "urn:ame:settlement-triggered-activity-publication-cell",
    settlement: active.account,
  });
  const result = await advanceWithHiredProviders(demandFromMessage(message), {
    expectedChain: active.deployment.chain,
    history,
  });
  const bytes = semanticBytes(relationalWitnessJournalDocument(result));
  const ni = rawNiUri(bytes);
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
      chain: active.deployment.chain,
      exchange: active.deployment.exchange,
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
