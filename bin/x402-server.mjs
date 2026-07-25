#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import express from "express";
import {
  createExactEvmPaymentBoundary,
  x402PaymentIdentity,
  x402SettlementEvidence,
} from "@emsenn/x402-services-section";
import { settlementCoordinate } from "../src/advance-settlement-pulse.mjs";
import { advanceWithHiredProviders, createPulseHistory } from "../src/runtime.mjs";

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
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
  const network = required("SETTLEMENT_CAIP2");
  const settlement = required("SETTLEMENT_ACCOUNT");
  const payTo = settlement.split(":").at(-1);
  const asset = required("X402_ASSET");
  const resourcePath = required("X402_RESOURCE_PATH");
  if (!/^\/[A-Za-z0-9/_-]+$/u.test(resourcePath)) throw new Error("X402_RESOURCE_PATH must be an absolute path");
  const quoted = await reservationQuote();
  const pending = new Map();
  const history = createPulseHistory({
    root: required("RWIL_DATA_ROOT"),
    agentUrl: required("RWIL_RDF_AGENT"),
    nodeId: "settlement-triggered-activity-publication-cell",
    actor: "urn:ame:settlement-triggered-activity-publication-cell",
    settlement,
  });
  const boundary = createExactEvmPaymentBoundary({
    network,
    facilitatorUrl: required("X402_FACILITATOR_URL"),
    routes: {
      [`POST ${resourcePath}`]: {
        accepts: [{
          scheme: "exact",
          network,
          price: {
            amount: quoted.atomicAmount,
            asset,
            extra: {
              name: required("X402_ASSET_NAME"),
              version: required("X402_ASSET_VERSION"),
            },
          },
          payTo,
        }],
        description: "Advance one settlement-triggered ActivityStreams pulse.",
      },
    },
    afterSettle: async (event) => {
      const settlementEvidence = x402SettlementEvidence(event);
      const invocation = settlementEvidence.invocation;
      const intent = pending.get(invocation) ?? history.records().find(
        (record) => record?.type === "X402PaidExecutionIntent" && record.invocation === invocation,
      );
      if (intent === undefined) throw new Error("settled x402 payment has no exact execution intent");
      await history.append({
        type: "X402SettlementReceipt",
        invocation,
        operation: "advance-settlement-pulse",
        settlement: settlementEvidence,
        pricing: quoted.quote,
      });
      try {
        const result = await advanceWithHiredProviders(intent.demand, {
          expectedChain: network,
          history,
        });
        await history.append({ type: "X402PaidExecutionReceipt", invocation, result });
      } catch (error) {
        await history.append({
          type: "X402PaidExecutionRefusal",
          invocation,
          reason: error instanceof Error ? error.message : String(error),
        });
      } finally {
        pending.delete(invocation);
      }
    },
  });
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "256kb" }));
  app.use(boundary.middleware);
  app.post(resourcePath, async (request, response) => {
    try {
      settlementCoordinate(request.body, { expectedChain: network });
      const invocation = x402PaymentIdentity(requiredHeader(request, "payment-signature"));
      const intent = {
        type: "X402PaidExecutionIntent",
        invocation,
        demand: structuredClone(request.body),
        pricing: quoted.quote,
      };
      await history.append(intent);
      pending.set(invocation, intent);
      response.status(202).json({
        ok: true,
        status: "settlement-pending",
        invocation,
        result: `${resourcePath.replace(/\/invoke$/u, "/result")}/${invocation.slice(7)}`,
      });
    } catch (error) {
      response.status(400).json({
        ok: false,
        refusal: {
          type: "SettlementTriggeredActivityPublicationRefusal",
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
  app.get(`${resourcePath.replace(/\/invoke$/u, "/result")}/:id`, (request, response) => {
    if (!/^[0-9a-f]{64}$/u.test(request.params.id)) {
      response.status(400).json({ ok: false, refusal: { type: "InvalidInvocationIdentity" } });
      return;
    }
    const invocation = `sha256:${request.params.id}`;
    const terminal = history.records().findLast(
      (record) => ["X402PaidExecutionReceipt", "X402PaidExecutionRefusal"].includes(record?.type)
        && record.invocation === invocation,
    );
    response.status(terminal === undefined ? 202 : 200).json({
      ok: true,
      invocation,
      status: terminal === undefined ? "pending" : "terminal",
      terminal: terminal ?? null,
    });
  });
  app.get("/offer", (_request, response) => response.json({
    operation: "advance-settlement-pulse",
    network,
    asset,
    payTo,
    pricing: quoted.quote,
  }));
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? "15627");
  app.listen(port, host, () => process.stdout.write(`${JSON.stringify({
    type: "SettlementPulseX402Listening",
    host,
    port,
    network,
    asset,
    payTo,
    atomicAmount: quoted.atomicAmount,
  })}\n`));
}

function requiredHeader(request, name) {
  const value = request.get(name);
  if (typeof value !== "string" || value === "") throw new Error(`${name} header is required`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
