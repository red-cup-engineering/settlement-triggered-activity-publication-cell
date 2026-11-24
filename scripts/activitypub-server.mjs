#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { serveActivityPubProvider } from "@red-cup-engineering/activitypub-server";
import { ACTIVITYSTREAMS_PUBLIC } from "@red-cup-engineering/activitypub-engineering-services-section/activitystreams";
import {
  projectSenActivity,
  senActivityObjectBytes,
} from "@red-cup-engineering/activitypub-engineering-services-section/sen-activity";
import {
  createPulseHistory,
  listPublishedActivities,
  publishedActivityForUrl,
} from "../src/runtime.mjs";
import {
  loadSuccessorAccountBinding,
  requireActiveSuccessorRecord,
} from "../src/successor-deployment.mjs";

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value;
}

export async function main() {
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
  const offer = requireActiveSuccessorRecord(
    JSON.parse(await readFile(requiredEnvironment("CAPABILITY_OFFER_PATH"), "utf8")),
    "org.emsenn.capability-offer.v3",
    "settlement-triggered-activity-publication-cell",
  );
  const offerActivity = projectSenActivity({
    type: "Offer",
    origin: requiredEnvironment("ACTIVITYPUB_ORIGIN"),
    identifier: requiredEnvironment("ACTIVITYPUB_IDENTIFIER"),
    recipient: ACTIVITYSTREAMS_PUBLIC,
    objectBytes: senActivityObjectBytes({ objectKind: "org.emsenn.capability-offer.v3", value: offer }),
    agentCard: offer.agentCard,
  });
  const activityForValues = async ({ chain, blockHash, logIndex }) => {
    const activities = await listPublishedActivities(history);
    const requested = [
      "activities",
      decodeURIComponent(chain),
      blockHash.toLowerCase(),
      logIndex,
    ];
    return activities.find((activity) => {
      if (typeof activity.id !== "string") return false;
      const parts = new URL(activity.id).pathname.split("/").filter(Boolean).map(decodeURIComponent);
      return parts.length === requested.length
        && parts.every((part, index) => part.toLowerCase() === requested[index].toLowerCase());
    }) ?? null;
  };
  return serveActivityPubProvider({
    origin: requiredEnvironment("ACTIVITYPUB_ORIGIN"),
    identifier: requiredEnvironment("ACTIVITYPUB_IDENTIFIER"),
    actorName: requiredEnvironment("ACTIVITYPUB_ACTOR_NAME"),
    summary: requiredEnvironment("ACTIVITYPUB_ACTOR_SUMMARY"),
    keyPath: requiredEnvironment("ACTIVITYPUB_KEYS_PATH"),
    statePath: requiredEnvironment("ACTIVITYPUB_STATE_PATH"),
    bearerTokenPath: requiredEnvironment("ACTIVITYPUB_INBOX_BEARER_TOKEN_FILE"),
    hostname: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? "15625"),
    listOutbox: async ({ cursor }) => ({
      items: cursor === undefined || cursor === null
        ? [offerActivity, ...await listPublishedActivities(history)]
        : [],
    }),
    activityPath: "/activities/{chain}/{blockHash}/{logIndex}",
    getActivity: activityForValues,
    resolvePublicActivity: async (url) => {
      if (offerActivity.id === url.href) return offerActivity;
      return /^\/activities\/[^/]+\/[^/]+\/[^/]+$/u.test(url.pathname)
        ? publishedActivityForUrl(history, url)
        : null;
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
