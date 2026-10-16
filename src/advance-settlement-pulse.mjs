import { isDeepStrictEqual } from "node:util";

const HASH = /^0x[0-9a-fA-F]{64}$/u;
const CHAIN = /^eip155:[1-9][0-9]*$/u;
const NI = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;

function requiredFunction(value, label) {
  if (typeof value !== "function") throw new TypeError(`${label} must be a function`);
  return value;
}

function exactInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a nonnegative safe integer`);
  return value;
}

function exactHash(value, label) {
  if (!HASH.test(value ?? "")) throw new TypeError(`${label} must be an EVM hash`);
  return value.toLowerCase();
}

function sameCoordinate(left, right) {
  return left.chain === right.chain
    && left.blockNumber === right.blockNumber
    && left.blockHash === right.blockHash
    && left.transactionHash === right.transactionHash
    && left.logIndex === right.logIndex;
}

function compareCoordinate(left, right) {
  if (left?.chain !== right.chain) throw new Error("settlement history crosses configured chain");
  exactInteger(left.blockNumber, "history blockNumber");
  exactHash(left.blockHash, "history blockHash");
  exactHash(left.transactionHash, "history transactionHash");
  exactInteger(left.logIndex, "history logIndex");
  if (left.blockNumber !== right.blockNumber) return left.blockNumber - right.blockNumber;
  if (left.blockHash !== right.blockHash) throw new Error("settlement coordinate conflicts at one block height");
  if (left.logIndex === right.logIndex && left.transactionHash !== right.transactionHash)
    throw new Error("settlement coordinate transaction conflicts at one log index");
  return left.logIndex - right.logIndex;
}

function activityFor(demand, coordinate) {
  const actor = new URL(demand.actor);
  if (actor.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(actor.hostname)) {
    throw new TypeError("pulse actor must use HTTPS outside loopback development");
  }
  const activity = new URL(
    `/activities/${encodeURIComponent(coordinate.chain)}/${coordinate.blockHash.slice(2)}/${coordinate.logIndex}`,
    actor,
  );
  return Object.freeze({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activity.href,
    type: "Create",
    actor: actor.href,
    to: demand.recipient,
    object: Object.freeze({
      type: "SettlementSuccessorPulse",
      coordinate,
      commitment: Object.freeze({ ...demand.commitment }),
    }),
  });
}

export function settlementCoordinate(demand, { expectedChain } = {}) {
  assertInput(demand);
  if (!CHAIN.test(expectedChain ?? "")) throw new TypeError("expectedChain must be an EVM CAIP-2 identifier");
  if (demand?.type !== "SettlementTriggeredActivityPublicationDemand") throw new TypeError("one settlement-triggered publication demand is required");
  if (demand.chain !== expectedChain) throw new Error(`demand must address configured chain ${expectedChain}`);
  const assay = demand.finalityAssay;
  const result = assay?.result;
  if (assay?.type !== "ReceiptFinalityPolicyAssay"
      || assay.positiveEvidence !== true
      || assay.negativeEvidence === true
      || result?.positiveEvidence !== true
      || result?.negativeEvidence === true) {
    throw new Error("an independently positive finality assay is required");
  }
  if (result.chainId !== expectedChain) throw new Error("finality assay addresses another chain");
  const coordinate = Object.freeze({
    chain: expectedChain,
    blockNumber: exactInteger(result.blockNumber, "finality blockNumber"),
    blockHash: exactHash(result.blockHash, "finality blockHash"),
    transactionHash: exactHash(result.transactionHash, "finality transactionHash"),
    logIndex: exactInteger(result.logIndex, "finality logIndex"),
  });
  const commitment = demand.commitment;
  if (commitment?.type !== "TypedCommitment"
      || ![commitment.rmnAct, commitment.predicate, commitment.subject, commitment.object, commitment.evidenceRoot].every((value) => NI.test(value ?? ""))) {
    throw new TypeError("one fully typed commitment is required");
  }
  const commitmentCoordinate = {
    ...coordinate,
    blockHash: exactHash(commitment.blockHash, "commitment blockHash"),
    transactionHash: exactHash(commitment.transactionHash, "commitment transactionHash"),
    logIndex: exactInteger(commitment.logIndex, "commitment logIndex"),
  };
  if (!sameCoordinate(coordinate, commitmentCoordinate)) throw new Error("commitment and finality coordinate differ");
  return coordinate;
}

export async function advanceSettlementPulse(demand, options = {}) {
  const coordinate = settlementCoordinate(demand, { expectedChain: options.expectedChain });
  const history = Array.isArray(options.history) ? options.history : [];
  const append = requiredFunction(options.append, "append");
  const publish = requiredFunction(options.publish, "publish");
  // A blockchain coordinate alone is not the identity of the published
  // assertion; bind every replay to the particular recipient and commitment.
  const expectedActivity = activityFor(demand, coordinate);
  const intents = history.filter(({ type }) => type === "SettlementPulsePublicationIntent");
  const receipts = history.filter(({ type }) => type === "SettlementPulsePublicationReceipt");

  for (const receipt of receipts) {
    const order = compareCoordinate(receipt.coordinate, coordinate);
    if (order > 0) throw new Error("settlement cursor would regress");
    if (order === 0) {
      if (receipt.activity?.id !== receipt.activityId
          || !isDeepStrictEqual(receipt.activity, expectedActivity)
          || receipt.delivery?.delivered !== true || receipt.delivery.activity !== receipt.activityId) {
        throw new Error("completed settlement pulse receipt conflicts with exact commitment or delivery");
      }
      return Object.freeze(assertOutput({ status: "already-delivered", activity: Object.freeze(receipt.activity), receipt: receipt.delivery }));
    }
  }

  const activity = expectedActivity;
  if (intents.some((intent) => (intent.activityId === activity.id || intent.activity?.id === activity.id)
      && !sameCoordinate(intent.coordinate, coordinate))) {
    throw new Error("settlement pulse activity ID collides with another coordinate");
  }
  const priorIntents = intents.filter((intent) => sameCoordinate(intent.coordinate, coordinate));
  if (priorIntents.some((intent) => intent.activityId !== activity.id
      || !isDeepStrictEqual(intent.activity, activity))) {
    throw new Error("settlement pulse intent conflicts with exact commitment or recipient");
  }
  const priorIntent = priorIntents[0];
  if (!priorIntent) {
    await append(Object.freeze({
      type: "SettlementPulsePublicationIntent",
      coordinate,
      activityId: activity.id,
      activity,
    }));
  }

  const delivery = await publish(activity);
  if (delivery?.delivered !== true || delivery.activity !== activity.id) {
    throw new Error("publication provider returned no exact delivery receipt");
  }
  await append(Object.freeze({
    type: "SettlementPulsePublicationReceipt",
    coordinate,
    activityId: activity.id,
    activity,
    delivery,
  }));
  return Object.freeze(assertOutput({ status: "delivered", activity, receipt: delivery }));
}
import { assertInput, assertOutput } from "./contracts.mjs";

