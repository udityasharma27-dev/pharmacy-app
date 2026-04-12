function normalizePhoneNumber(value) {
  return String(value || "").replace(/\D/g, "").trim();
}

function normalizeBirthDate(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw.replace(/-/g, "");
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";

  const year = String(parsed.getFullYear()).padStart(4, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function normalizeCustomerName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function buildCustomerUsername(phone) {
  return normalizePhoneNumber(phone);
}

function buildCustomerPassword(fullName, birthDate) {
  const namePart = normalizeCustomerName(fullName);
  const birthPart = normalizeBirthDate(birthDate);

  if (!namePart || !birthPart) return "";
  return `${namePart}${birthPart}`;
}

function buildCustomerPasswordVariants(fullName, birthDate) {
  const namePart = normalizeCustomerName(fullName);
  const birthPart = normalizeBirthDate(birthDate);

  if (!namePart || !birthPart) return [];

  return Array.from(new Set([
    `${namePart}${birthPart}`,
    `${birthPart}${namePart}`
  ]));
}

module.exports = {
  normalizePhoneNumber,
  normalizeBirthDate,
  normalizeCustomerName,
  buildCustomerUsername,
  buildCustomerPassword,
  buildCustomerPasswordVariants
};
