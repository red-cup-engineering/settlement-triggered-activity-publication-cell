// successor-activation — this cell's successor-chain activation profile, projected by the
// x402 exact-purchase service's projectSuccessorActivation.
const HOST = "https://bare-cedar-fog.561.group";

export const settlementPulseCell = Object.freeze({
  nodeId: "settlement-triggered-activity-publication-cell",
  slug: "settlement-pulse",
  operation: "advance-settlement-pulse",
  github: { repository: "https://github.com/red-cup-engineering/settlement-triggered-activity-publication-cell" },
  activitypub: { outbox: `${HOST}/actors/settlement-pulse/outbox` },
  x402: { resource: `${HOST}/x402/settlement-pulse/invoke`, offer: `${HOST}/x402/settlement-pulse/offer` },
  agentCardPath: "content/agent-cards/settlement-triggered-activity-publication-cell.json",
  invocationPath: "content/invocations/current.json",
  observedProjection: true,
});
