const assert = require("node:assert/strict");
const { hashPassword, verifyPassword, createToken, verifyToken } = require("../utils/auth");
const { recordAudit } = require("../utils/audit");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    return false;
  }
}

const results = [];

results.push(run("hashPassword produces verifiable hashes", () => {
  const password = "pharmacy-secret";
  const hash = hashPassword(password);
  assert.equal(typeof hash, "string");
  assert.ok(hash.includes(":"));
  assert.equal(verifyPassword(password, hash), true);
  assert.equal(verifyPassword("wrong-password", hash), false);
}));

results.push(run("createToken and verifyToken round-trip valid sessions", () => {
  const token = createToken({
    _id: "abc123",
    username: "admin",
    role: "owner",
    fullName: "Owner"
  });

  const parsed = verifyToken(token);
  assert.ok(parsed);
  assert.equal(parsed.id, "abc123");
  assert.equal(parsed.username, "admin");
  assert.equal(parsed.role, "owner");
  assert.ok(parsed.exp > parsed.iat);
}));

results.push(run("verifyToken rejects malformed tokens", () => {
  assert.equal(verifyToken(""), null);
  assert.equal(verifyToken("abc"), null);
  assert.equal(verifyToken("a.b"), null);
}));

results.push(run("recordAudit export exists", () => {
  assert.equal(typeof recordAudit, "function");
}));

if (results.every(Boolean)) {
  console.log("All tests passed.");
  process.exit(0);
}

process.exit(1);
