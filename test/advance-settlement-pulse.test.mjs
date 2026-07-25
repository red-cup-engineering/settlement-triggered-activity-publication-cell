import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceSettlementPulse,
  settlementCoordinate,
} from "../src/advance-settlement-pulse.mjs";

const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;
const TX_A = `0x${"c".repeat(64)}`;
const NI_A = `ni:///sha-256;${"A".repeat(43)}`;
const NI_B = `ni:///sha-256;${"B".repeat(43)}`;
const NI_C = `ni:///sha-256;${"C".repeat(43)}`;
const NI_D = `ni:///sha-256;${"D".repeat(43)}`;
const ACTOR = "https://settlement-pulse.actions.561.group/actors/settlement-pulse";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const CONFIG = { expectedChain: "eip155:5615610" };

function demand(overrides = {}) {
  return {
    type: "SettlementTriggeredActivityPublicationDemand",
    chain: "eip155:5615610",
    actor: ACTOR,
    recipient: PUBLIC,
    finalityAssay: {
      type: "ReceiptFinalityPolicyAssay",
      positiveEvidence: true,
      negativeEvidence: false,
      result: {
        chainId: "eip155:5615610",
        blockNumber: 24,
        blockHash: HASH_A,
        transactionHash: TX_A,
        logIndex: 3,
        finalityPolicy: NI_A,
        positiveEvidence: true,
        negativeEvidence: false,
      },
    },
    commitment: {
      type: "TypedCommitment",
      rmnAct: NI_B,
      predicate: NI_C,
      subject: NI_D,
      object: NI_A,
      evidenceRoot: NI_B,
      transactionHash: TX_A,
      blockHash: HASH_A,
      logIndex: 3,
    },
    ...overrides,
  };
}

function memory(initial = []) {
  const records = [...initial];
  return {
    records,
    append: async (record) => {
      records.push(structuredClone(record));
      return { id: `memory:${records.length}` };
    },
  };
}

test("settlement coordinate is exact, chain-qualified, and totally ordered", () => {
  assert.deepEqual(settlementCoordinate(demand(), CONFIG), {
    chain: "eip155:5615610",
    blockNumber: 24,
    blockHash: HASH_A,
    transactionHash: TX_A,
    logIndex: 3,
  });
});

test("one positive finality assay authors and publishes one deterministic successor pulse", async () => {
  const book = memory();
  const publications = [];
  const result = await advanceSettlementPulse(demand(), {
    ...CONFIG,
    history: book.records,
    append: book.append,
    publish: async (activity) => {
      publications.push(structuredClone(activity));
      return { type: "ActivityPubDeliveryReceipt", delivered: true, activity: activity.id };
    },
  });

  assert.equal(result.status, "delivered");
  assert.equal(publications.length, 1);
  assert.equal(result.activity.id, publications[0].id);
  assert.equal(result.activity.type, "Create");
  assert.equal(result.activity.actor, ACTOR);
  assert.equal(result.activity.to, PUBLIC);
  assert.equal(result.activity.object.type, "SettlementSuccessorPulse");
  assert.deepEqual(result.activity.object.coordinate, settlementCoordinate(demand(), CONFIG));
  assert.equal(result.activity.object.commitment.rmnAct, NI_B);
  assert.equal("published" in result.activity, false, "wall time must not enter the causal act");
  assert.deepEqual(book.records.map(({ type }) => type), [
    "SettlementPulsePublicationIntent",
    "SettlementPulsePublicationReceipt",
  ]);
});

test("a completed coordinate replays without publishing twice", async () => {
  const book = memory();
  let calls = 0;
  const publish = async (activity) => {
    calls += 1;
    return { type: "ActivityPubDeliveryReceipt", delivered: true, activity: activity.id };
  };
  const first = await advanceSettlementPulse(demand(), { ...CONFIG, history: book.records, append: book.append, publish });
  const second = await advanceSettlementPulse(demand(), { ...CONFIG, history: book.records, append: book.append, publish });
  assert.equal(calls, 1);
  assert.equal(second.status, "already-delivered");
  assert.equal(second.activity.id, first.activity.id);
});

test("ambiguous transport preserves the intent and retries the identical activity", async () => {
  const book = memory();
  let firstActivity;
  await assert.rejects(
    advanceSettlementPulse(demand(), {
      ...CONFIG,
      history: book.records,
      append: book.append,
      publish: async (activity) => {
        firstActivity = structuredClone(activity);
        throw new Error("transport outcome unknown");
      },
    }),
    /transport outcome unknown/u,
  );
  assert.deepEqual(book.records.map(({ type }) => type), ["SettlementPulsePublicationIntent"]);

  let retriedActivity;
  const result = await advanceSettlementPulse(demand(), {
    ...CONFIG,
    history: book.records,
    append: book.append,
    publish: async (activity) => {
      retriedActivity = structuredClone(activity);
      return { type: "ActivityPubDeliveryReceipt", delivered: true, activity: activity.id };
    },
  });
  assert.deepEqual(retriedActivity, firstActivity);
  assert.equal(result.status, "delivered");
});

test("foreign chains, nonfinal assays, coordinate mismatches, and regressions are refused", async () => {
  const noEffects = {
    ...CONFIG,
    history: [],
    append: async () => assert.fail("refusal must not append"),
    publish: async () => assert.fail("refusal must not publish"),
  };
  await assert.rejects(
    advanceSettlementPulse(demand({ chain: "eip155:561561" }), noEffects),
    /eip155:5615610/u,
  );
  await assert.rejects(
    advanceSettlementPulse(demand({
      finalityAssay: {
        ...demand().finalityAssay,
        positiveEvidence: false,
      },
    }), noEffects),
    /positive finality/u,
  );
  await assert.rejects(
    advanceSettlementPulse(demand({
      commitment: { ...demand().commitment, blockHash: HASH_B },
    }), noEffects),
    /coordinate/u,
  );
  const prior = [{
    type: "SettlementPulsePublicationReceipt",
    coordinate: {
      ...settlementCoordinate(demand(), CONFIG),
      blockNumber: 25,
      blockHash: HASH_B,
      logIndex: 0,
    },
    activityId: "https://settlement-pulse.actions.561.group/activities/prior",
  }];
  await assert.rejects(
    advanceSettlementPulse(demand(), { ...noEffects, history: prior }),
    /regress/u,
  );
});
