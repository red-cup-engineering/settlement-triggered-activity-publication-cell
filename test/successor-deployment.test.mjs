import assert from "node:assert/strict";
import test from "node:test";
import {
  loadSuccessorAccountBinding,
  loadSuccessorDeployment,
  loadSuccessorX402Binding,
  SuccessorChainMigrationObstruction,
} from "../src/successor-deployment.mjs";

const manifest = new URL(
  "../../ethereum-services-section/data/deployments/eip155-5615611-semiotic-exchange.json",
  import.meta.url,
);

test("loads the canonical successor CAIP-2 and exact SemioticExchange coordinate", async () => {
  const deployment = await loadSuccessorDeployment(manifest);
  assert.equal(deployment.chain, "eip155:5615611");
  assert.equal(deployment.exchange, "0xc4234dc42c9d93bc7d61b0354aba2729ae52e322");
  assert.equal(deployment.deploymentBlock, 70);
});

test("fails closed when successor x402 facilitator and asset bindings are unverified", async () => {
  const deployment = await loadSuccessorDeployment(manifest);
  await assert.rejects(loadSuccessorX402Binding({
    deployment,
    account: "eip155:5615611:0x1111111111111111111111111111111111111111",
    nodeId: "settlement-triggered-activity-publication-cell",
  }), (error) => {
    assert.ok(error instanceof SuccessorChainMigrationObstruction);
    assert.equal(error.code, "SUCCESSOR_X402_BINDING_UNBOUND");
    assert.match(error.requirement, /facilitator, asset, and payee binding/u);
    return true;
  });
});

test("fails closed with the exact identity migration requirement when no successor account exists", async () => {
  await assert.rejects(loadSuccessorAccountBinding({
    manifestPath: manifest,
    nodeId: "settlement-triggered-activity-publication-cell",
  }), (error) => {
    assert.ok(error instanceof SuccessorChainMigrationObstruction);
    assert.equal(error.code, "SUCCESSOR_CHAIN_IDENTITY_UNBOUND");
    assert.equal(error.chain, "eip155:5615611");
    assert.match(error.requirement, /verified eip155:5615611 enterprise-account binding/u);
    return true;
  });
});
