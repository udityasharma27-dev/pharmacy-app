const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const Medicine = require("../models/Medicine");
const PaymentSession = require("../models/PaymentSession");
const { requireAuth } = require("../middleware/auth");
const {
  buildCustomerSnapshot,
  buildDiscountLine,
  summarizeDiscountLines
} = require("../services/discountService");
const { getOfferConfig } = require("../services/offerConfigService");
const { evaluateOfferRules } = require("../services/offersEngine");

function isManualUpiConfirmationAllowed() {
  return String(process.env.ALLOW_MANUAL_UPI_CONFIRM || "true").trim().toLowerCase() !== "false";
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "").trim();
}

router.use(requireAuth);

router.post("/session", async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const provider = String(req.body.provider || "manual-upi").trim() || "manual-upi";
    const requestedCustomer = req.body.customer || {};
    const store = {
      storeId: String(req.body.store?.storeId || req.user.storeId || "").trim(),
      storeName: String(req.body.store?.storeName || req.user.storeName || "").trim()
    };

    if (!items.length) {
      return res.status(400).json({ success: false, message: "Cart is empty" });
    }

    const normalizedPhone = normalizePhone(requestedCustomer.phone);
    const customerRecord = normalizedPhone
      ? await Customer.findOne({ phone: normalizedPhone }).lean()
      : null;
    const customer = buildCustomerSnapshot(customerRecord, requestedCustomer);
    const offerConfig = await getOfferConfig();
    const mergedItems = new Map();
    const normalizedItems = [];

    for (const item of items) {
      const quantity = Number(item.quantity);

      if (!item.medId || !item.brandId || !Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: "Each cart item must include a medicine, brand, and positive quantity"
        });
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
        return res.status(404).json({ success: false, message: "Medicine not found" });
      }

      const brand = medicine.brands.id(item.brandId);

      if (!brand) {
        return res.status(404).json({ success: false, message: "Brand not found" });
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

    const session = await PaymentSession.create({
      userId: req.user.id,
      store,
      items: normalizedItems,
      customer: {
        phone: customer.phone,
        name: customer.name,
        isMember: customer.membership,
        membership: customer.membership,
        membershipDiscountPercent: 0,
        visit_count: customer.visit_count,
        last_purchase_date: customer.last_purchase_date
      },
      subtotalAmount: totals.subtotalAmount,
      discountAmount: totals.discountAmount,
      totalAmount: totals.totalAmount,
      provider
    });

    res.json({
      success: true,
      sessionId: String(session._id),
      status: session.status,
      totalAmount: session.totalAmount,
      subtotalAmount: session.subtotalAmount,
      discountAmount: session.discountAmount,
      customer: session.customer
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to create payment session" });
  }
});

router.get("/session/:id", async (req, res) => {
  try {
    const session = await PaymentSession.findById(req.params.id);

    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ success: false, message: "Payment session not found" });
    }

    res.json({
      success: true,
      session: {
        id: String(session._id),
        status: session.status,
        subtotalAmount: session.subtotalAmount,
        discountAmount: session.discountAmount,
        totalAmount: session.totalAmount,
        provider: session.provider,
        customer: session.customer,
        paymentReference: session.paymentReference,
        billId: session.billId
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to load payment session" });
  }
});

router.post("/session/:id/manual-confirm", async (req, res) => {
  try {
    if (!isManualUpiConfirmationAllowed()) {
      return res.status(403).json({ success: false, message: "Manual UPI confirmation is disabled" });
    }

    const session = await PaymentSession.findById(req.params.id);

    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ success: false, message: "Payment session not found" });
    }

    if (session.status === "BILLED") {
      return res.status(400).json({ success: false, message: "Bill already generated" });
    }

    session.provider = "manual-upi";
    session.status = "PAID";
    session.paymentReference = String(req.body.paymentReference || "").trim() || `UPI-${Date.now()}`;
    await session.save();

    res.json({
      success: true,
      status: session.status,
      paymentReference: session.paymentReference
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to confirm UPI payment" });
  }
});

router.post("/session/:id/cash-received", async (req, res) => {
  try {
    const session = await PaymentSession.findById(req.params.id);

    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ success: false, message: "Payment session not found" });
    }

    if (session.status === "BILLED") {
      return res.status(400).json({ success: false, message: "Bill already generated" });
    }

    const provider = String(req.body.provider || session.provider || "cash").trim() || "cash";

    session.provider = provider;
    session.status = "PAID";
    session.paymentReference = String(req.body.paymentReference || "").trim() || `${provider.toUpperCase()}-${Date.now()}`;
    await session.save();

    res.json({
      success: true,
      status: session.status,
      provider: session.provider,
      paymentReference: session.paymentReference
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to confirm cash payment" });
  }
});

module.exports = router;
