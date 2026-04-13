function normalizeOrderSource(value) {
  return String(value || "").trim().toLowerCase() === "online" ? "online" : "in_store";
}

function normalizeCustomerContext(value) {
  return String(value || "").trim().toLowerCase() === "self_service" ? "self_service" : "staff_controlled";
}

function normalizeCustomerAppStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "active" || normalized === "invited") return normalized;
  return "store_only";
}

module.exports = {
  normalizeOrderSource,
  normalizeCustomerContext,
  normalizeCustomerAppStatus
};
