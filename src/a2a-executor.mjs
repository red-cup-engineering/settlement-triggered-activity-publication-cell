#!/usr/bin/env node
import { identity } from "@red-cup-engineering/signcell/values";

import { randomUUID } from "node:crypto";
import { messageFromJson, messageToJson } from "@red-cup-engineering/a2a-engine/json-wire";
import { ROLE_AGENT, ROLE_USER, extractSenPart, senPart } from "@red-cup-engineering/a2a-engine/sen-part";
import {
  EMPTY_WITNESS_ROOT,
  admitJsonSemanticContent,
  identifyJsonSemanticContent,
} from "@red-cup-engineering/computer-code-engine/semiotic-expression-notation/semantic-content-identity";
import { relationalSeavtDocument } from "@red-cup-engineering/semiotic-eavt-engineering-services-section/documents";
import { advanceWithHiredProviders, createPulseHistory } from "./runtime.mjs";
import { loadSuccessorAccountBinding } from "./successor-deployment.mjs";

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value;
}

const DEMAND_KIND = "settlement-triggered-activity-publication.demand";
const RESULT_KIND = "settlement-triggered-activity-publication.result";

function demandFromMessage(source) {
  const message = identity(source);
  if (message.role !== ROLE_USER) throw new TypeError("A2A demand requires ROLE_USER");
  const { bytes } = extractSenPart(message.parts);
  return admitJsonSemanticContent({ bytes, objectKind: DEMAND_KIND }).value;
}

export async function executeMessage(message) {
  const active = await loadSuccessorAccountBinding({
    manifestPath: requiredEnvironment("EVM_DEPLOYMENT_MANIFEST"),
    accountBindingPath: process.env.SETTLEMENT_ACCOUNT_BINDING,
    nodeId: "settlement-triggered-activity-publication-cell",
  });
  const history = createPulseHistory({
    root: requiredEnvironment("SEAVT_DOCUMENT_ROOT"),
    agentUrl: requiredEnvironment("SEAVT_DOCUMENT_AGENT"),
    nodeId: "settlement-triggered-activity-publication-cell",
    actor: "urn:ame:settlement-triggered-activity-publication-cell",
    settlement: active.account,
  });
  const result = await advanceWithHiredProviders(demandFromMessage(message), {
    expectedChain: active.deployment.chain,
    history,
  });
  const { bytes } = identifyJsonSemanticContent({
    objectKind: RESULT_KIND,
    value: relationalSeavtDocument(result),
    witnessRoot: EMPTY_WITNESS_ROOT,
  });
  return {
    messageId: randomUUID(),
    role: ROLE_AGENT,
    parts: [senPart(bytes, "settlement-pulse-result.sen.cbor")],
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
  const message = messageFromJson(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  process.stdout.write(`${JSON.stringify(messageToJson(await executeMessage(message)))}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
