#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import express from "express";
import { createPricedCapabilityBoundary } from "@red-cup-engineering/x402-services-section/priced-capability-boundary";
import { settlementCoordinate } from "../src/advance-settlement-pulse.mjs";
import { assertRefusal } from "../src/contracts.mjs";
import { advanceWithHiredProviders, createPulseHistory } from "../src/runtime.mjs";
import { requireActiveSuccessorRecord } from "@red-cup-engineering/x402-exact-purchase-service/successor-deployment";
import { loadSuccessorX402Binding } from "@red-cup-engineering/x402-exact-purchase-service/successor-deployment";
import { loadSuccessorAccountBinding } from "@red-cup-engineering/x402-exact-purchase-service/successor-deployment";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-operation-engineering-services-section/operation";

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value;
}

function requiredHeader(request, name) {
  const value = request.get(name);
  if (typeof value !== "string" || value === "") throw new Error(`${name} header is required`);
  return value;
}

async function reservationQuote() {
  const demand = JSON.parse(await readFile(required("PRICE_QUOTE_DEMAND"), "utf8"));
  const response = await fetch(required("PRICE_QUOTE_URL"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(demand),
  });
  const body = await response.json();
  if (!response.ok || body?.ok !== true) throw new Error(`pricing provider refused: ${body?.refusal?.message ?? response.status}`);
  const amount = body.result?.consideration?.amount;
  if (amount?.denominator !== "1" || !/^[1-9][0-9]*$/u.test(amount.numerator ?? "")) {
    throw new Error("x402 boundary requires a positive integer atomic price from the pricing provider");
  }
  return Object.freeze({ demand, quote: body.result, atomicAmount: amount.numerator });
}

export async function main() {
  const operation = "advance-settlement-pulse";
  const active = await loadSuccessorAccountBinding({
    manifestPath: required("EVM_DEPLOYMENT_MANIFEST"),
    accountBindingPath: process.env.SETTLEMENT_ACCOUNT_BINDING,
    nodeId: "settlement-triggered-activity-publication-cell",
  });
  const network = active.deployment.chain;
  const settlement = active.account;
  const economic = await loadSuccessorX402Binding({
    path: process.env.X402_BINDING,
    deployment: active.deployment,
    account: active.account,
    nodeId: "settlement-triggered-activity-publication-cell",
  });
  const resourcePath = required("X402_RESOURCE_PATH");
  const resultPath = resourcePath.replace(/\/invoke$/u, "/result");
  const offerPath = resourcePath.replace(/\/invoke$/u, "/offer");
  const quoted = await reservationQuote();
  const offer = requireActiveSuccessorRecord(
    JSON.parse(await readFile(required("CAPABILITY_OFFER_PATH"), "utf8")),
    "org.emsenn.capability-offer.v3",
    "settlement-triggered-activity-publication-cell",
  );
  const history = createPulseHistory({
    root: required("WITNESS_JOURNAL_DATA_ROOT"),
    agentUrl: required("WITNESS_JOURNAL_RDF_AGENT"),
    nodeId: "settlement-triggered-activity-publication-cell",
    actor: "urn:ame:settlement-triggered-activity-publication-cell",
    settlement,
  });
  const records = await history.records();
  const recoveredRecords = {
    intents: new Map(records
      .filter((record) => record?.type === "X402PaidExecutionIntent")
      .map((record) => [record.invocation, record])),
    terminals: new Map(records
      .filter((record) => ["X402PaidExecutionReceipt", "X402PaidExecutionRefusal"].includes(record?.type))
      .map((record) => [record.invocation, record])),
  };
  const seller = createPricedCapabilityBoundary({
    operation,
    resourcePath,
    offerPath,
    resultPath,
    offer,
    priceTerms: {
      network,
      amount: quoted.atomicAmount,
      asset: economic.asset,
      payTo: economic.payTo,
      extra: {
        name: economic.assetName,
        version: economic.assetVersion,
      },
      description: "Advance one settlement-triggered ActivityStreams pulse.",
      quote: quoted.quote,
    },
    facilitatorUrl: economic.facilitatorUrl,
    recoveredRecords,
    append: (record) => history.append(record),
    admit: async ({ request }) => {
      const authorization = requiredHeader(request, "authorization");
      const matched = /^OCapN (urn:ocapn:sturdyref:[A-Za-z0-9_-]{43})$/u.exec(authorization);
      if (matched === null) throw new Error("one OCapN sturdy reference is required");
      const response = await fetch(required("OCAPN_ADMISSION_URL"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sturdyRef: matched[1], locus: operation }),
      });
      const admission = await response.json();
      if (!response.ok || admission?.admitted !== true) {
        throw new Error(`OCapN provider refused: ${admission?.reason ?? response.status}`);
      }
      await history.append({ type: "OCapNAdmissionReceipt", operation, admission });
      return admission;
    },
    createIntent: ({ invocation, request }) => {
      settlementCoordinate(request, { expectedChain: network });
      return { type: "X402PaidExecutionIntent", invocation, demand: request, pricing: quoted.quote };
    },
    execute: ({ intent }) => advanceWithHiredProviders(intent.demand, {
      expectedChain: network,
      history,
    }),
    createReceipt: ({ invocation, result }) => ({ type: "X402PaidExecutionReceipt", invocation, result }),
    createRefusal: ({ invocation, error }) => assertRefusal({
      type: "X402PaidExecutionRefusal",
      invocation,
      reason: error instanceof Error ? error.message : String(error),
    }),
  });
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json({ limit: Infinity }));
  seller.install(app);
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? "15627");
  app.listen(port, host, () => process.stdout.write(`${JSON.stringify({
    type: "SettlementPulseX402Listening",
    host,
    port,
    network,
    atomicAmount: quoted.atomicAmount,
  })}\n`));
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "x402-server", description: "main — the x402-server operation.", operation: main }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
