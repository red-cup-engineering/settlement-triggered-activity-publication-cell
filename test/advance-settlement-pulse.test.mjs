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

test("completed pulse replay is bound to exact commitment and recipient, not only an EVM coordinate", async () => {
  const book = memory();
  let publications = 0;
  const publish = async (activity) => {
    publications++;
    return {type: "ActivityPubDeliveryReceipt", delivered: true, activity: activity.id};
  };
  await advanceSettlementPulse(demand(), {...CONFIG, history: book.records, append: book.append, publish});
  assert.equal(book.records.length, 2);
  for (const altered of [
    demand({commitment: {...demand().commitment, evidenceRoot: NI_C}}),
    demand({commitment: {...demand().commitment, subject: NI_A}}),
    demand({recipient: "https://another.example.test/actors/receiver"}),
    demand({actor: "https://another.example.test/actors/publisher"}),
  ]) {
    await assert.rejects(
      advanceSettlementPulse(altered, {...CONFIG, history: book.records, append: book.append, publish}),
      /completed settlement pulse receipt conflicts/u,
    );
  }
  assert.equal(publications, 1, "replayed contradictory assertions must not publish");
  assert.equal(book.records.length, 2, "replayed contradictory assertions must not append");
});

test("an ambiguous first publication cannot have its pending intent repurposed", async () => {
  const book = memory();
  let publications = 0;
  const publish = async (activity) => {
    publications++;
    if (publications === 1) throw new Error("transport unknown");
    return {type: "ActivityPubDeliveryReceipt", delivered: true, activity: activity.id};
  };
  await assert.rejects(
    advanceSettlementPulse(demand(), {...CONFIG, history: book.records, append: book.append, publish}),
    /transport unknown/u,
  );
  assert.equal(book.records.length, 1);
  await assert.rejects(
    advanceSettlementPulse(
      demand({commitment: {...demand().commitment, object: NI_C}}),
      {...CONFIG, history: book.records, append: book.append, publish},
    ),
    /settlement pulse intent conflicts/u,
  );
  assert.equal(publications, 1, "no altered notification should be sent on retry");
  assert.equal(book.records.length, 1);
  const valid = await advanceSettlementPulse(demand(), {...CONFIG, history: book.records, append: book.append, publish});
  assert.equal(valid.status, "delivered");
  assert.equal(publications, 2);
});

test("incomplete delivery receipts and cross-chain history refuse replay", async () => {
  const book = memory();
  const publish = async (activity) => ({
    type: "ActivityPubDeliveryReceipt", delivered: true, activity: activity.id,
  });
  await advanceSettlementPulse(demand(), {...CONFIG, history: book.records, append: book.append, publish});
  const oldDelivery = book.records[1].delivery;
  book.records[1].delivery = {...oldDelivery, activity: "https://other.example.test/different"};
  await assert.rejects(
    advanceSettlementPulse(demand(), {...CONFIG, history: book.records, append: book.append, publish}),
    /completed settlement pulse receipt conflicts/u,
  );
  book.records[1].delivery = oldDelivery;
  book.records[1].coordinate.chain = "eip155:999";
  await assert.rejects(
    advanceSettlementPulse(demand(), {...CONFIG, history: book.records, append: book.append, publish}),
    /settlement history crosses configured chain/u,
  );
});

test("one block and log index cannot alias two distinct transaction hashes", async () => {
  const book = memory();
  const publish = async (activity) => ({delivered: true, activity: activity.id});
  await advanceSettlementPulse(demand(), {...CONFIG, history: book.records, append: book.append, publish});
  book.records[1].coordinate.transactionHash = HASH_B;
  await assert.rejects(
    advanceSettlementPulse(demand(), {...CONFIG, history: book.records, append: book.append, publish}),
    /settlement coordinate transaction conflicts at one log index/u,
  );
});

test("an existing activity identifier cannot be republished using a different coordinate", async () => {
  const book = memory();
  await assert.rejects(
    advanceSettlementPulse(demand(), {...CONFIG, history: book.records, append: book.append,
      publish: async () => { throw new Error("unknown delivery"); }}),
    /unknown delivery/u,
  );
  book.records[0].coordinate.transactionHash = HASH_B;
  await assert.rejects(
    advanceSettlementPulse(demand(), {...CONFIG, history: book.records, append: book.append,
      publish: async () => assert.fail("must not publish ID with conflicting coordinate")}),
    /settlement pulse activity ID collides with another coordinate/u,
  );
  assert.equal(book.records.length, 1);
});
