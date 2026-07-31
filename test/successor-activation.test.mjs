import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { projectSettlementSuccessorActivation } from "../src/successor-activation.mjs";

const deploymentUrl = new URL("../../ethereum-services-section/data/deployments/eip155-5615611-semiotic-exchange.json", import.meta.url);
const deployment = JSON.parse(await readFile(deploymentUrl, "utf8"));
const card = JSON.parse(await readFile(new URL(
  "../content/agent-cards/settlement-triggered-activity-publication-cell.json", import.meta.url), "utf8"));
const factory = "0x402616b746c56deb665bd163f32ec4b8e7dc0916";
const exchange = "0xc4234dc42c9d93bc7d61b0354aba2729ae52e322";

function account(address = `0x${"a".repeat(40)}`) {
  return { profile: "org.emsenn.evm.sovereign-enterprise-account.v3",
    enterprise: { nodeId: "settlement-triggered-activity-publication-cell",
      urn: "urn:ame:settlement-triggered-activity-publication-cell", enterpriseId: `0x${"1".repeat(64)}` },
    chain: { chainId: 5615611, caip2: "eip155:5615611" },
    account: { address, caip10: `eip155:5615611:${address}` },
    factory: { address: factory, userSalt: `0x${"2".repeat(64)}` },
    policy: { signer: `0x${"3".repeat(40)}`, custody: "remote-cloud-kms-hsm", keyVersion: "projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1" },
    deployment: { transaction: `0x${"4".repeat(64)}`, block: 71 } };
}

function economic(payTo = `0x${"a".repeat(40)}`) {
  return { type: "SuccessorX402Binding", network: "eip155:5615611", exchange,
    facilitatorUrl: "https://facilitator.example.test", asset: `0x${"5".repeat(40)}`,
    payTo, assetName: "Successor Credit", assetVersion: "1", amount: "12" };
}

test("activation refuses missing or unverified successor bindings", () => {
  assert.throws(() => projectSettlementSuccessorActivation({ deployment, agentCardTemplate: card }), /EnterpriseAccountBinding/u);
  assert.throws(() => projectSettlementSuccessorActivation({ deployment, accountBinding: account(), agentCardTemplate: card }), /SuccessorX402Binding/u);
  assert.throws(() => projectSettlementSuccessorActivation({ deployment, accountBinding: account(), x402Binding: economic(`0x${"b".repeat(40)}`), agentCardTemplate: card }), /SuccessorX402Binding/u);
});

test("projects one exact unsigned active successor candidate without live claims", () => {
  const projected = projectSettlementSuccessorActivation({ deployment, accountBinding: account(), x402Binding: economic(), agentCardTemplate: card });
  const offer = projected.outputs["content/offers/current.json"];
  assert.equal(offer.price.network, "eip155:5615611");
  assert.equal(offer.price.asset, `0x${"5".repeat(40)}`);
  assert.equal(offer.price.amount, "12");
  assert.equal(offer.price.payTo, `0x${"a".repeat(40)}`);
  assert.equal(offer.signing.status, "unsigned-candidate");
  assert.deepEqual(offer.signing.receipts, []);
  assert.equal(projected.outputs["content/health/current.json"].state, "configured-not-live-observed");
  assert.equal(projected.outputs["content/capcell/observed-projections.json"].networkCallsMadeByProjector, 0);
});

test("claims an offer signature only from an injected verified receipt bound to the exact payload", () => {
  const unsigned = projectSettlementSuccessorActivation({ deployment, accountBinding: account(), x402Binding: economic(), agentCardTemplate: card });
  const payload = unsigned.outputs["content/offers/current.json"].id;
  const receipt = { type: "DetachedContentSigningReceipt", version: 1, disposition: "signed",
    id: `ni:///sha-256;${"A".repeat(43)}`, payload,
    controller: `did:pkh:eip155:5615611:0x${"a".repeat(40)}`,
    algorithm: "EdDSA", keyId: "did:example:successor#key-1", signature: "detached-signature" };
  assert.throws(() => projectSettlementSuccessorActivation({ deployment, accountBinding: account(),
    x402Binding: economic(), agentCardTemplate: card, offerSigningReceipt: receipt }), /real detached receipt/u);
  receipt.verification = { disposition: "verified", verifier: "injected-signature-verifier" };
  const signed = projectSettlementSuccessorActivation({ deployment, accountBinding: account(),
    x402Binding: economic(), agentCardTemplate: card, offerSigningReceipt: receipt });
  assert.equal(signed.outputs["content/offers/current.json"].signing.status, "signed");
  assert.deepEqual(signed.outputs["content/offers/current.json"].signing.receipts, [receipt]);
});

test("repeat projection is byte-for-byte idempotent", () => {
  const first = projectSettlementSuccessorActivation({ deployment, accountBinding: account(), x402Binding: economic(), agentCardTemplate: card });
  const second = projectSettlementSuccessorActivation({ deployment, accountBinding: account(), x402Binding: economic(),
    agentCardTemplate: first.outputs["content/agent-cards/settlement-triggered-activity-publication-cell.json"] });
  assert.equal(JSON.stringify(second), JSON.stringify(first));
});

test("owning materializer reports a complete repeat as unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "settlement-successor-activation-"));
  const put = async (relative, value) => {
    const target = join(root, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
  };
  try {
    await put("content/evm/accounts/eip155-5615611.json", account());
    await put("content/x402/eip155-5615611.json", economic());
    await put("content/agent-cards/settlement-triggered-activity-publication-cell.json", card);
    const script = fileURLToPath(new URL("../scripts/project-successor-activation-records.mjs", import.meta.url));
    const args = [script, "--root", root, "--deployment", fileURLToPath(deploymentUrl)];
    const first = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).changed.length, 9);
    const second = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr);
    const receipt = JSON.parse(second.stdout);
    assert.equal(receipt.changed.length, 0);
    assert.equal(receipt.unchanged.length, 9);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a changed verified controller readdresses identity, manifest, offer, and outbox", () => {
  const first = projectSettlementSuccessorActivation({ deployment, accountBinding: account(), x402Binding: economic(), agentCardTemplate: card });
  const nextAddress = `0x${"b".repeat(40)}`;
  const second = projectSettlementSuccessorActivation({ deployment, accountBinding: account(nextAddress), x402Binding: economic(nextAddress), agentCardTemplate: card });
  assert.notEqual(second.outputs["content/capcell/identity.json"].id, first.outputs["content/capcell/identity.json"].id);
  assert.notEqual(second.outputs["content/capcell/manifest.json"].id, first.outputs["content/capcell/manifest.json"].id);
  assert.notEqual(second.outputs["content/offers/current.json"].id, first.outputs["content/offers/current.json"].id);
  assert.notEqual(second.outputs["content/activitypub/outbox.json"][0].id, first.outputs["content/activitypub/outbox.json"][0].id);
});

test("successor projection contains no predecessor identity or economic term", () => {
  const projected = projectSettlementSuccessorActivation({ deployment, accountBinding: account(), x402Binding: economic(), agentCardTemplate: card });
  assert.equal(JSON.stringify(projected).includes("5615610"), false);
});
