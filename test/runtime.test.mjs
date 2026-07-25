import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceWithHiredProviders,
  OUTBOX_RECORD_TYPE,
  publishedActivityForUrl,
} from "../src/runtime.mjs";

const NI = (letter) => `ni:///sha-256;${letter.repeat(43)}`;
const HASH = (letter) => `0x${letter.repeat(64)}`;

function demand() {
  return {
    type: "SettlementTriggeredActivityPublicationDemand",
    chain: "eip155:9",
    actor: "https://example.test/actors/pulse",
    recipient: "https://www.w3.org/ns/activitystreams#Public",
    finalityAssay: {
      type: "ReceiptFinalityPolicyAssay",
      positiveEvidence: true,
      negativeEvidence: false,
      result: {
        chainId: "eip155:9",
        blockNumber: 7,
        blockHash: HASH("a"),
        transactionHash: HASH("b"),
        logIndex: 2,
        finalityPolicy: NI("A"),
        positiveEvidence: true,
        negativeEvidence: false,
      },
    },
    commitment: {
      type: "TypedCommitment",
      rmnAct: NI("B"),
      predicate: NI("C"),
      subject: NI("D"),
      object: NI("E"),
      evidenceRoot: NI("F"),
      blockHash: HASH("a"),
      transactionHash: HASH("b"),
      logIndex: 2,
    },
  };
}

function memory() {
  const rows = [];
  return {
    records: () => structuredClone(rows),
    append: async (row) => rows.push(structuredClone(row)),
  };
}

test("runtime retains an outbox publication between intent and receipt", async () => {
  const history = memory();
  const first = await advanceWithHiredProviders(demand(), {
    expectedChain: "eip155:9",
    history,
  });
  assert.equal(first.status, "delivered");
  assert.deepEqual(history.records().map(({ type }) => type), [
    "SettlementPulsePublicationIntent",
    OUTBOX_RECORD_TYPE,
    "SettlementPulsePublicationReceipt",
  ]);

  const replay = await advanceWithHiredProviders(demand(), {
    expectedChain: "eip155:9",
    history,
  });
  assert.equal(replay.status, "already-delivered");
  assert.equal(history.records().filter(({ type }) => type === OUTBOX_RECORD_TYPE).length, 1);
  assert.deepEqual(
    publishedActivityForUrl(history, new URL(first.activity.id)),
    first.activity,
  );
});

test("RWIL key ordering does not change exact ActivityStreams equality", async () => {
  const rows = [];
  const recursivelySorted = (value) => {
    if (Array.isArray(value)) return value.map(recursivelySorted);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, recursivelySorted(value[key])]),
    );
  };
  const history = {
    records: () => structuredClone(rows),
    append: async (row) => rows.push(recursivelySorted(structuredClone(row))),
  };
  const result = await advanceWithHiredProviders(demand(), {
    expectedChain: "eip155:9",
    history,
  });
  assert.equal(result.status, "delivered");
});
