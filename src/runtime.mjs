import {
  querySettlementRecords,
  recordSettlementRecord,
} from "@lenticule-science/witness-journal-rdf-projection-service/client";
import { Activity } from "@fedify/vocab";
import { isDeepStrictEqual } from "node:util";
import { advanceSettlementPulse } from "./advance-settlement-pulse.mjs";
import { assertState } from "./contracts.mjs";

export const HISTORY_CATEGORY = "settlement-triggered-activity-publication";
export const OUTBOX_RECORD_TYPE = "SettlementPulseOutboxPublication";

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function exactActivity(left, right) {
  return isDeepStrictEqual(left, right);
}

export function createPulseHistory(options) {
  const root = requiredText(options?.root, "RWIL data root");
  const agentUrl = requiredText(options?.agentUrl, "RWIL/RDF Agent Card URL");
  const nodeId = requiredText(options?.nodeId, "cell node ID");
  const actor = requiredText(options?.actor, "cell actor");
  const settlement = requiredText(options?.settlement, "settlement account");
  const now = options.now ?? (() => new Date().toISOString());

  return Object.freeze({
    async records() {
      return await querySettlementRecords(HISTORY_CATEGORY);
    },
    async append(record) {
      assertState(record);
      return recordSettlementRecord({
        agentUrl,
        settlement,
        actor,
        category: HISTORY_CATEGORY,
        recordedAt: now(),
        record,
      });
    },
  });
}

export async function listPublishedActivities(history) {
  const records = await history.records();
  const publications = records
    .filter((record) => record?.type === OUTBOX_RECORD_TYPE)
    .map((record) => record.activity);
  return Promise.all(publications.map((activity) => Activity.fromJsonLd(activity)));
}

export async function publishedActivityForUrl(history, url) {
  const expected = url instanceof URL ? url.href : new URL(url).href;
  return (await history.records()).find(
    (record) => record?.type === OUTBOX_RECORD_TYPE && record.activity?.id === expected,
  )?.activity ?? null;
}

export async function advanceWithHiredProviders(demand, {
  expectedChain,
  history,
} = {}) {
  if (history === null || typeof history !== "object"
      || typeof history.records !== "function" || typeof history.append !== "function") {
    throw new TypeError("a hired durable history provider is required");
  }
  const records = await history.records();
  return advanceSettlementPulse(demand, {
    expectedChain,
    history: records,
    append: (record) => history.append(record),
    publish: async (activity) => {
      const prior = (await history.records()).find(
        (record) => record?.type === OUTBOX_RECORD_TYPE && record.activity?.id === activity.id,
      );
      if (prior !== undefined) {
        if (!exactActivity(prior.activity, activity)) {
          throw new Error("public outbox already binds the activity ID to different content");
        }
      } else {
        await history.append(Object.freeze({
          type: OUTBOX_RECORD_TYPE,
          activity,
        }));
      }
      const retained = (await history.records()).find(
        (record) => record?.type === OUTBOX_RECORD_TYPE && exactActivity(record.activity, activity),
      );
      if (retained === undefined) throw new Error("ActivityPub outbox provider did not retain the exact activity");
      return Object.freeze({
        type: "ActivityPubOutboxPublicationReceipt",
        delivered: true,
        activity: activity.id,
      });
    },
  });
}
