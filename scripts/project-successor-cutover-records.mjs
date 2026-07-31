#!/usr/bin/env node

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cell = path.resolve(here, "..");
const info = path.resolve(cell, "../../../../../../../../../../../..");
const x402 = path.join(
  info,
  "lib/emsenn/services/561-group/services/red-cup-engineering/services/software-services-section/services/web-services-section/services/x402-services-section/services/x402-exact-purchase-service",
);
const deploymentPath = path.join(
  info,
  "lib/emsenn/services/561-group/services/red-cup-engineering/services/software-services-section/services/blockchain-services-section/services/ethereum-services-section/data/deployments/eip155-5615611-semiotic-exchange.json",
);
const deployment = JSON.parse(await readFile(deploymentPath, "utf8"));
const exchange = deployment.deployments?.find(
  (entry) => entry.role === "modeled-union-dimension-exchange"
    && entry.standard === "org.emsenn.semiotic-exchange-chain.v1",
);
if (deployment.chainId !== "eip155:5615611" || exchange?.address === undefined) {
  throw new Error("canonical successor deployment manifest is incomplete");
}
const coordinate = Object.freeze({
  chain: deployment.chainId,
  exchange: exchange.address.toLowerCase(),
  deploymentBlock: exchange.blockNumber,
  deploymentTransaction: exchange.transactionHash,
  manifest: path.relative(info, deploymentPath),
});
const requirement = (nodeId) =>
  `Provision and verify one eip155:5615611 EnterpriseAccount for ${nodeId}; verify its successor x402 facilitator, asset contract, and payee; then regenerate its account/x402 bindings, Agent Card, capability identity, and offer through their owning services.`;

async function writeJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function archive(root, relative, kind) {
  const source = path.join(root, relative);
  let record;
  let sourceText;
  try {
    sourceText = await readFile(source, "utf8");
    record = JSON.parse(sourceText);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!sourceText.includes("5615610")) return;
  const target = path.join(root, "content/archives/eip155-5615610", relative.replace(/^content\//u, ""));
  await writeJson(target, {
    type: "HistoricalChainProjectionArchive",
    historical: true,
    chain: "eip155:5615610",
    recordKind: kind,
    source: relative,
    record,
  });
  await unlink(source);
}

const cellArchives = [
  ["content/evm/accounts/eip155-5615610.json", "enterprise-account-binding"],
  ["content/capcell/observed-projections.json", "observed-projection"],
  ["content/capcell/manifest.json", "capability-cell-manifest"],
  ["content/offers/current.json", "capability-offer"],
  ["content/invocations/ocapn-paid-live-demand.json", "settlement-demand"],
  ["content/invocations/safe-sequencing-live-demand.json", "settlement-demand"],
];
const x402Archives = [
  ["content/evm/accounts/eip155-5615610.json", "enterprise-account-binding"],
  ["content/capcell/customer-invocation.json", "customer-invocation"],
  ["content/capcell/identity.json", "capability-cell-identity"],
  ["content/capcell/manifest.json", "capability-cell-manifest"],
  ["content/offers/current.json", "capability-offer"],
  ["content/activitypub/outbox.json", "activitypub-outbox"],
];
for (const [relative, kind] of cellArchives) await archive(cell, relative, kind);
for (const [relative, kind] of x402Archives) await archive(x402, relative, kind);

const obstruction = (nodeId, surface) => ({
  type: "SuccessorChainMigrationObstruction",
  code: "SUCCESSOR_CHAIN_IDENTITY_UNBOUND",
  state: "unavailable",
  nodeId,
  surface,
  deployment: coordinate,
  requirement: requirement(nodeId),
});

await writeJson(path.join(cell, "content/migrations/eip155-5615611.json"),
  obstruction("settlement-triggered-activity-publication-cell", "all-active-faces"));
await writeJson(path.join(x402, "content/migrations/eip155-5615611.json"),
  obstruction("x402-exact-purchase-service", "all-active-faces"));
await writeJson(path.join(cell, "content/offers/current.json"),
  obstruction("settlement-triggered-activity-publication-cell", "capability-offer"));
await writeJson(path.join(cell, "content/capcell/manifest.json"),
  obstruction("settlement-triggered-activity-publication-cell", "capability-cell-manifest"));
await writeJson(path.join(cell, "content/capcell/identity.json"),
  obstruction("settlement-triggered-activity-publication-cell", "capability-cell-identity"));
await writeJson(path.join(cell, "content/capcell/observed-projections.json"),
  obstruction("settlement-triggered-activity-publication-cell", "observed-projection"));
await writeJson(path.join(cell, "content/invocations/current.json"),
  obstruction("settlement-triggered-activity-publication-cell", "invocation-state"));
await writeJson(path.join(cell, "content/health/current.json"),
  obstruction("settlement-triggered-activity-publication-cell", "health"));
await writeJson(path.join(x402, "content/offers/current.json"),
  obstruction("x402-exact-purchase-service", "capability-offer"));
await writeJson(path.join(x402, "content/capcell/identity.json"),
  obstruction("x402-exact-purchase-service", "capability-cell-identity"));
await writeJson(path.join(x402, "content/capcell/manifest.json"),
  obstruction("x402-exact-purchase-service", "capability-cell-manifest"));
await writeJson(path.join(x402, "content/capcell/customer-invocation.json"),
  obstruction("x402-exact-purchase-service", "customer-invocation"));
await writeJson(path.join(x402, "content/health/current.json"),
  obstruction("x402-exact-purchase-service", "health"));

async function projectAgentCard(root, relative, nodeId) {
  const target = path.join(root, relative);
  const card = JSON.parse(await readFile(target, "utf8"));
  const suffix = " Active settlement is unavailable until the recorded eip155:5615611 identity migration is completed.";
  card.description = `${card.description.replaceAll(suffix, "")}${suffix}`;
  for (const extension of card.capabilities?.extensions ?? []) {
    const params = extension.params ?? {};
    delete params.account;
    delete params.controller;
    delete params.x402;
    params.settlementDeployment = coordinate;
    params.availability = {
      state: "unavailable",
      code: "SUCCESSOR_CHAIN_IDENTITY_UNBOUND",
      requirement: requirement(nodeId),
    };
  }
  delete card.activation;
  card.signatures = [];
  await writeJson(target, card);
}
await projectAgentCard(
  cell,
  "content/agent-cards/settlement-triggered-activity-publication-cell.json",
  "settlement-triggered-activity-publication-cell",
);
await projectAgentCard(
  x402,
  "content/agent-cards/x402-exact-purchase.json",
  "x402-exact-purchase-service",
);
await writeJson(path.join(x402, "content/activitypub/outbox.json"), [{
  "@context": "https://www.w3.org/ns/activitystreams",
  id: "https://bare-cedar-fog.561.group/activities/x402-exact-purchase/migration/eip155-5615611",
  type: "Announce",
  actor: "https://bare-cedar-fog.561.group/actors/x402-exact-purchase",
  to: "https://www.w3.org/ns/activitystreams#Public",
  object: obstruction("x402-exact-purchase-service", "activitypub-publication"),
}]);
await writeJson(path.join(cell, "content/activitypub/outbox.json"), [{
  "@context": "https://www.w3.org/ns/activitystreams",
  id: "https://bare-cedar-fog.561.group/activities/settlement-pulse/migration/eip155-5615611",
  type: "Announce",
  actor: "https://bare-cedar-fog.561.group/actors/settlement-pulse",
  to: "https://www.w3.org/ns/activitystreams#Public",
  object: obstruction("settlement-triggered-activity-publication-cell", "activitypub-publication"),
}]);
