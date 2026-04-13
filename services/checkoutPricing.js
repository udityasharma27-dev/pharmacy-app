const Customer = require("../models/Customer");
const Medicine = require("../models/Medicine");
const {
  buildCustomerSnapshot,
  buildDiscountLine,
  summarizeDiscountLines
} = require("./discountService");
const { getOfferConfig } = require("./offerConfigService");
const { evaluateOfferRules } = require("./offersEngine");
const { normalizeOrderSource, normalizeCustomerContext } = require("./commerceMode");

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "").trim();
}

function createCheckoutError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getFallbackOfferConfig() {
  return {
    mondayMemberOffer: {
      enabled: true,
      extraDiscountPercent: 3
    },
    globalOffer: {
      enabled: false,
      discountPercent: 0,
      label: "Global Offer"
    }
  };
}

async function buildCheckoutPayload(req) {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const provider = String(req.body.provider || "manual-upi").trim() || "manual-upi";
  const source = normalizeOrderSource(req.body.source);
  const customerContext = normalizeCustomerContext(req.body.customerContext);
  const requestedCustomer = req.body.customer || {};
  const fallbackCustomer = req.user.role === "customer"
    ? {
      phone: req.user.phone || "",
      name: req.user.fullName || ""
    }
    : {};
  const store = {
    storeId: String(req.body.store?.storeId || req.user.storeId || "").trim(),
    storeName: String(req.body.store?.storeName || req.user.storeName || "").trim()
  };

  if (!items.length) {
    throw createCheckoutError(400, "Cart is empty");
  }

  const effectiveCustomer = { ...fallbackCustomer, ...requestedCustomer };
  const normalizedPhone = normalizePhone(effectiveCustomer.phone);
  let customerRecord = null;

  if (normalizedPhone) {
    try {
      customerRecord = await Customer.findOne({ phone: normalizedPhone }).lean();
    } catch (error) {
      console.warn("Customer lookup failed during checkout payload build", {
        message: error?.message,
        phone: normalizedPhone
      });
    }
  }

  const customer = buildCustomerSnapshot(customerRecord, effectiveCustomer);
  let offerConfig = getFallbackOfferConfig();

  try {
    offerConfig = await getOfferConfig();
  } catch (error) {
    console.warn("Offer config lookup failed during checkout payload build", {
      message: error?.message
    });
  }

  const mergedItems = new Map();
  const normalizedItems = [];

  for (const item of items) {
    const quantity = Number(item.quantity);

    if (!item.medId || !item.brandId || !Number.isInteger(quantity) || quantity <= 0) {
      throw createCheckoutError(
        400,
        "Each cart item must include a medicine, brand, and positive quantity"
      );
    }

    const key = `${item.medId}:${item.brandId}`;
    mergedItems.set(key, {
      medId: item.medId,
      brandId: item.brandId,
      quantity: (mergedItems.get(key)?.quantity || 0) + quantity
    });
  }

  for (const item of mergedItems.values()) {
    const medicine = await Medicine.findById(item.medId);

    if (!medicine) {
      throw createCheckoutError(404, "Medicine not found");
    }

    const brand = medicine.brands.id(item.brandId);

    if (!brand) {
      throw createCheckoutError(404, "Brand not found");
    }

    if (Number(brand.quantity || 0) < item.quantity) {
      throw createCheckoutError(400, `Not enough stock for ${brand.name}`);
    }

    const line = buildDiscountLine({
      medicine,
      brand,
      quantity: item.quantity,
      customer
    });
    const offerEvaluation = evaluateOfferRules({
      customer,
      baseDiscountPercent: line.baseDiscountPercent,
      offerConfig
    });

    line.discountPercent = offerEvaluation.finalDiscountPercent;
    line.extraDiscountPercent = offerEvaluation.extraDiscountPercent;
    line.appliedOffers = offerEvaluation.appliedOffers;
    line.discountAmount = Number((line.lineSubtotal * (line.discountPercent / 100)).toFixed(2));
    line.total = Number(Math.max(0, line.lineSubtotal - line.discountAmount).toFixed(2));
    line.profit = Number((line.total - (line.costPrice * line.quantity)).toFixed(2));

    normalizedItems.push(line);
  }

  const totals = summarizeDiscountLines(normalizedItems);

  return {
    provider,
    source,
    customerContext,
    store,
    customer: {
      phone: customer.phone,
      name: customer.name,
      isMember: customer.membership,
      membership: customer.membership,
      membershipDiscountPercent: 0,
      visit_count: customer.visit_count,
      last_purchase_date: customer.last_purchase_date
    },
    items: normalizedItems,
    subtotalAmount: totals.subtotalAmount,
    discountAmount: totals.discountAmount,
    totalAmount: totals.totalAmount
  };
}

module.exports = {
  buildCheckoutPayload,
  createCheckoutError
};
