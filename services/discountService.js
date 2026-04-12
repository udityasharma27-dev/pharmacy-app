function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function isValidPhone(phone) {
  const normalized = String(phone || "").replace(/\D/g, "").trim();
  return normalized.length >= 10;
}

function getProjectedVisitCount(customer = {}) {
  const currentVisitCount = Number(customer.visit_count || 0);
  return Number.isFinite(currentVisitCount) && currentVisitCount >= 0
    ? currentVisitCount + 1
    : 1;
}

function getPricingBucket(category, brandType) {
  if (normalizeText(category) === "otc") {
    return "OTC";
  }

  return normalizeText(brandType) === "generic" ? "GENERIC" : "BRANDED";
}

function getDiscountPercent({ membership = false, visitCount = 0, category, brandType }) {
  const bucket = getPricingBucket(category, brandType);

  if (!membership) {
    if (bucket === "GENERIC") return 18;
    if (bucket === "OTC") return 12;
    return 5;
  }

  if (bucket === "BRANDED") {
    if (visitCount >= 5) return 12;
    if (visitCount >= 2) return 10;
    return 7;
  }

  if (bucket === "GENERIC") {
    if (visitCount >= 5) return 35;
    if (visitCount >= 2) return 25;
    return 20;
  }

  if (visitCount >= 5) return 25;
  if (visitCount >= 2) return 22;
  return 18;
}

function buildCustomerSnapshot(customer = {}, fallback = {}) {
  const membership = Boolean(customer.membership ?? customer.isMember);
  const visitCount = Math.max(0, Number(customer.visit_count || 0) || 0);
  const phone = String(customer.phone || fallback.phone || "").replace(/\D/g, "").trim();
  const name = String(customer.name || fallback.name || "").trim();

  return {
    phone,
    name,
    membership,
    isMember: membership,
    visit_count: visitCount,
    last_purchase_date: customer.last_purchase_date || null,
    hasTrackedCustomer: isValidPhone(phone)
  };
}

function buildDiscountLine({ medicine, brand, quantity, customer }) {
  const unitPrice = Number(brand.price || 0);
  const unitCostPrice = Number(brand.costPrice || 0);
  const safeQuantity = Number(quantity || 0);
  const projectedVisitCount = getProjectedVisitCount(customer);
  const categoryType = getPricingBucket(medicine.category, brand.brandType);
  const baseDiscountPercent = getDiscountPercent({
    membership: customer.membership,
    visitCount: projectedVisitCount,
    category: medicine.category,
    brandType: brand.brandType
  });
  const finalDiscountPercent = roundMoney(baseDiscountPercent);
  const lineSubtotal = roundMoney(unitPrice * safeQuantity);
  const discountAmount = roundMoney(lineSubtotal * (finalDiscountPercent / 100));
  const lineTotal = roundMoney(Math.max(0, lineSubtotal - discountAmount));
  const lineProfit = roundMoney(lineTotal - (unitCostPrice * safeQuantity));

  return {
    medId: String(medicine._id),
    brandId: String(brand._id),
    name: brand.name,
    quantity: safeQuantity,
    price: unitPrice,
    costPrice: unitCostPrice,
    category: medicine.category || "General",
    categoryType,
    brandType: brand.brandType || "Branded",
    lineSubtotal,
    baseDiscountPercent,
    discountPercent: finalDiscountPercent,
    extraDiscountPercent: 0,
    appliedOffers: [],
    discountAmount,
    total: lineTotal,
    profit: lineProfit
  };
}

function summarizeDiscountLines(lines) {
  const summary = lines.reduce((result, line) => {
    result.subtotalAmount += Number(line.lineSubtotal || 0);
    result.discountAmount += Number(line.discountAmount || 0);
    result.totalAmount += Number(line.total || 0);
    result.totalProfit += Number(line.profit || 0);
    return result;
  }, {
    subtotalAmount: 0,
    discountAmount: 0,
    totalAmount: 0,
    totalProfit: 0
  });

  return {
    subtotalAmount: roundMoney(summary.subtotalAmount),
    discountAmount: roundMoney(summary.discountAmount),
    totalAmount: roundMoney(summary.totalAmount),
    totalProfit: roundMoney(summary.totalProfit)
  };
}

module.exports = {
  buildCustomerSnapshot,
  buildDiscountLine,
  summarizeDiscountLines,
  getDiscountPercent,
  getProjectedVisitCount,
  getPricingBucket
};
