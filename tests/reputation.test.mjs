/** ERC-8004 con puertos controlados: no firma ni califica agentes públicos. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentReputation } from "../src/infrastructure/ethereum/agent-reputation.mjs";

// Un mismo encargo confirmado se recupera sin enviar un segundo feedback.
test("reputación confirma y recupera feedback sin duplicarlo", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "campus-reputation-"));
  let sends = 0;
  const protocol = {
    rpc: {
      async getTransactionReceipt() {
        return { status: 1, blockNumber: 123 };
      },
    },
    async tx(label, pending) {
      const tx = await pending;
      return { evidence: { label, hash: tx.hash } };
    },
  };
  const adapter = new AgentReputation(root, protocol);
  adapter.check = async () => {};
  adapter.load = async () => ({ agentId: "42" });
  adapter.registry = {
    async giveFeedback(...args) {
      sends++;
      assert.equal(args[0], "42");
      assert.equal(args[1], 100);
      assert.equal(args[5], "eip155:11155111:0xabc/jobs/3");
      return { hash: "0xfixture" };
    },
  };
  const run = {
    id: "prueba",
    jobId: "3",
    contract: "0xabc",
    summaryHash: "hash",
    evaluation: { decision: "approve" },
    status: "completed",
  };
  try {
    assert.equal((await adapter.record(run)).value, 100);
    assert.equal((await adapter.record(run)).transaction.hash, "0xfixture");
    assert.equal(sends, 1);
    assert.equal(await adapter.record({ ...run, error: "IPFS" }), null);
    assert.equal(await adapter.record({ ...run, status: "needs-recovery" }), null);
    assert.equal(await adapter.record({ ...run, reputation: {} }), null);
  } finally {
    await fs.rm(root, { recursive: true });
  }
});

// La media debe distinguir la ausencia de opiniones de una calificación cero.
test("consulta reputación limitada al evaluador y distingue falta de feedback", async () => {
  const adapter = new AgentReputation("/tmp", {
    evaluator: {
      async getAddress() {
        return "evaluador";
      },
    },
  });
  adapter.check = async () => {};
  adapter.load = async () => ({ agentId: "1" });
  adapter.registry = {
    async getSummary(id, evaluators, tag1, tag2) {
      assert.deepEqual(evaluators, ["evaluador"]);
      assert.equal(tag1, "campus-summary");
      assert.equal(tag2, "quality");
      return [0n, 0n, 0n];
    },
  };
  assert.equal((await adapter.read()).averageScore, null);
});
