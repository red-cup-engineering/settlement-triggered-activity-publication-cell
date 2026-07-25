#!/usr/bin/env node

import { serveActivityPubProvider } from "@emsenn/activitypub-services-section/server";
import {
  createPulseHistory,
  listPublishedActivities,
  publishedActivityForUrl,
} from "../src/runtime.mjs";

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value;
}

export async function main() {
  const history = createPulseHistory({
    root: requiredEnvironment("RWIL_DATA_ROOT"),
    agentUrl: requiredEnvironment("RWIL_RDF_AGENT"),
    nodeId: "settlement-triggered-activity-publication-cell",
    actor: "urn:ame:settlement-triggered-activity-publication-cell",
    settlement: requiredEnvironment("SETTLEMENT_ACCOUNT"),
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
      if (activity.id === null) return false;
      const parts = activity.id.pathname.split("/").filter(Boolean).map(decodeURIComponent);
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
        ? await listPublishedActivities(history)
        : [],
    }),
    activityPath: "/activities/{chain}/{blockHash}/{logIndex}",
    getActivity: activityForValues,
    resolvePublicActivity: async (url) =>
      /^\/activities\/[^/]+\/[^/]+\/[^/]+$/u.test(url.pathname)
        ? publishedActivityForUrl(history, url)
        : null,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
