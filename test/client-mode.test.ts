import assert from "node:assert/strict";
import test from "node:test";

test("a missing private key keeps the client in free-preview mode", async () => {
  const mode = await import("../src/client-mode.ts");
  assert.deepEqual(mode.clientMode(undefined), { canSpend: false, label: "free-preview" });
  assert.deepEqual(mode.clientMode("0xabc"), { canSpend: true, label: "paid" });
});
