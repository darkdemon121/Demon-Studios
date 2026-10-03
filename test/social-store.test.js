import assert from "node:assert/strict";
import test from "node:test";
import { createSocialStore, decryptSocialSecret, encryptSocialSecret } from "../lib/social-store.js";

test("social token encryption round-trips with a 256-bit key", () => {
  const key = Buffer.alloc(32, 7);
  const encrypted = encryptSocialSecret("provider-access-token", key);
  assert.notEqual(encrypted, "provider-access-token");
  assert.equal(decryptSocialSecret(encrypted, key), "provider-access-token");
});

test("social token encryption rejects tampered ciphertext", () => {
  const key = Buffer.alloc(32, 3);
  const encrypted = encryptSocialSecret("private-token", key);
  const [iv, tag, ciphertext] = encrypted.split(".");
  const changed = `${iv}.${tag}.${Buffer.from(ciphertext, "base64url").map((value, index) => index === 0 ? value ^ 1 : value).toString("base64url")}`;
  assert.throws(() => decryptSocialSecret(changed, key));
});

test("social store refuses to initialize without Turso credentials", async () => {
  const store = createSocialStore({ url: "", authToken: "", connectFactory: () => { throw new Error("must not connect"); } });
  await assert.rejects(store.ensureSchema(), error => error.statusCode === 503);
});