const assert = require("node:assert/strict");
const { hashPassword, verifyPassword, createToken, verifyToken } = require("../utils/auth");
const { recordAudit } = require("../utils/audit");
const { evaluateOfferRules } = require("../services/offersEngine");
const { buildCustomerSnapshot } = require("../services/discountService");
const {
  normalizeOrderSource,
  normalizeCustomerContext,
  normalizeCustomerAppStatus
} = require("../services/commerceMode");
const {
  buildCustomerUsername,
  buildCustomerPassword,
  buildCustomerPasswordVariants,
  normalizeBirthDate
} = require("../services/customerCredentials");

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

results.push(run("offers engine adds monday member offer on top of base discount", () => {
  const result = evaluateOfferRules({
    customer: { membership: true },
    baseDiscountPercent: 10,
    offerConfig: {
      mondayMemberOffer: { enabled: true, extraDiscountPercent: 3 },
      globalOffer: { enabled: false, discountPercent: 0 }
    },
    now: new Date("2026-04-13T10:00:00.000Z")
  });

  assert.equal(result.baseDiscountPercent, 10);
  assert.equal(result.extraDiscountPercent, 3);
  assert.equal(result.finalDiscountPercent, 13);
  assert.equal(result.appliedOffers.length, 1);
  assert.equal(result.appliedOffers[0].code, "MONDAY_MEMBER");
}));

results.push(run("offers engine composes global and monday offers with a single final price", () => {
  const result = evaluateOfferRules({
    customer: { membership: true },
    baseDiscountPercent: 20,
    offerConfig: {
      mondayMemberOffer: { enabled: true, extraDiscountPercent: 5 },
      globalOffer: { enabled: true, discountPercent: 20, label: "Flash Sale" }
    },
    now: new Date("2026-04-13T10:00:00.000Z")
  });

  assert.equal(result.extraDiscountPercent, 25);
  assert.equal(result.finalDiscountPercent, 45);
  assert.equal(result.appliedOffers.length, 2);
}));

results.push(run("buildCustomerSnapshot preserves fallback membership data for new customers", () => {
  const snapshot = buildCustomerSnapshot({}, {
    phone: "9876543210",
    name: "New Member",
    isMember: true,
    visit_count: 2,
    last_purchase_date: "2026-04-10T00:00:00.000Z"
  });

  assert.equal(snapshot.phone, "9876543210");
  assert.equal(snapshot.name, "New Member");
  assert.equal(snapshot.membership, true);
  assert.equal(snapshot.isMember, true);
  assert.equal(snapshot.visit_count, 2);
  assert.equal(snapshot.last_purchase_date, "2026-04-10T00:00:00.000Z");
}));

results.push(run("commerce mode normalizers keep assisted store flow safe by default", () => {
  assert.equal(normalizeOrderSource(), "in_store");
  assert.equal(normalizeOrderSource("online"), "online");
  assert.equal(normalizeOrderSource("anything-else"), "in_store");
  assert.equal(normalizeCustomerContext(), "staff_controlled");
  assert.equal(normalizeCustomerContext("self_service"), "self_service");
  assert.equal(normalizeCustomerAppStatus(), "store_only");
  assert.equal(normalizeCustomerAppStatus("invited"), "invited");
  assert.equal(normalizeCustomerAppStatus("active"), "active");
}));

results.push(run("customer credentials derive phone username and name-plus-birthdate password", () => {
  assert.equal(buildCustomerUsername("+91 98765 43210"), "919876543210");
  assert.equal(normalizeBirthDate("1998-04-23"), "19980423");
  assert.equal(buildCustomerPassword("Riya Sharma", "1998-04-23"), "riyasharma19980423");
  assert.deepEqual(
    buildCustomerPasswordVariants("Riya Sharma", "1998-04-23"),
    ["riyasharma19980423", "19980423riyasharma"]
  );
}));

if (results.every(Boolean)) {
  console.log("All tests passed.");
  process.exit(0);
}

process.exit(1);
