const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const Medicine = require("../models/Medicine");
const Bill = require("../models/Bill");
const PaymentSession = require("../models/PaymentSession");
const { requireAuth } = require("../middleware/auth");
const { recordAudit } = require("../utils/audit");

router.use(requireAuth);

async function buildInvoiceNumber() {
  const now = new Date();
  const monthCode = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `LVP-${monthCode}-`;
  const latestBill = await Bill.findOne({
    invoiceNumber: { $regex: `^${prefix}` }
  }).sort({ createdAt: -1, _id: -1 }).lean();
  const latestSequence = latestBill?.invoiceNumber
    ? Number(String(latestBill.invoiceNumber).split("-").pop())
    : 0;
  const nextSequence = Number.isFinite(latestSequence) ? latestSequence + 1 : 1;
  return `${prefix}${String(nextSequence).padStart(4, "0")}`;
}

router.post("/", async (req, res) => {
  try {
    const paymentSessionId = String(req.body.paymentSessionId || "").trim();

    if (!paymentSessionId) {
      return res.status(400).json({ success: false, message: "Payment session is required" });
    }

    const paymentSession = await PaymentSession.findById(paymentSessionId);

    if (!paymentSession || paymentSession.userId !== req.user.id) {
      return res.status(404).json({ success: false, message: "Payment session not found" });
    }

    if (paymentSession.status !== "PAID") {
      return res.status(400).json({
        success: false,
        message: "Bill can only be generated after successful payment"
      });
    }

    if (paymentSession.billId) {
      const existingBill = await Bill.findById(paymentSession.billId);

      return res.json({
        success: true,
        subtotalAmount: existingBill?.subtotalAmount || paymentSession.subtotalAmount || paymentSession.totalAmount,
        discountAmount: existingBill?.discountAmount || paymentSession.discountAmount || 0,
        totalAmount: existingBill?.totalAmount || paymentSession.totalAmount,
        totalProfit: existingBill?.totalProfit || 0,
        billId: paymentSession.billId,
        invoiceNumber: existingBill?.invoiceNumber || ""
      });
    }

    const items = Array.isArray(paymentSession.items) ? paymentSession.items : [];

    if (items.length === 0) {
      return res.status(400).json({ success: false, message: "Cart is empty" });
    }

    const mergedItems = new Map();

    for (const item of items) {
      const key = `${item.medId}:${item.brandId}`;
      const quantity = Number(item.quantity);

      if (!item.medId || !item.brandId || !Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: "Each cart item must include a medicine, brand, and positive quantity"
        });
      }

      mergedItems.set(key, {
        medId: item.medId,
        brandId: item.brandId,
        quantity: (mergedItems.get(key)?.quantity || 0) + quantity
      });
    }

    const preparedItems = [];

    for (const item of mergedItems.values()) {
      const quantity = item.quantity;
      const med = await Medicine.findById(item.medId);

      if (!med) {
        return res.status(404).json({ success: false, message: "Medicine not found" });
      }

      const brand = med.brands.id(item.brandId);

      if (!brand) {
        return res.status(404).json({ success: false, message: "Brand not found" });
      }

      if (brand.quantity < quantity) {
        return res.status(400).json({
          success: false,
          message: `Not enough stock for ${brand.name}`
        });
      }

      preparedItems.push({ med, brand, quantity });
    }

    let subtotal = 0;
    let totalProfit = 0;
    let discountAmount = 0;
    const billItems = [];

    for (const item of preparedItems) {
      const sessionItem = items.find(entry => String(entry.medId) === String(item.med._id) && String(entry.brandId) === String(item.brand._id));
      const lineSubtotal = Number(sessionItem?.lineSubtotal ?? (item.brand.price * item.quantity));
      const lineDiscountAmount = Number(sessionItem?.discountAmount || 0);
      const lineTotal = Number(sessionItem?.total ?? Math.max(0, lineSubtotal - lineDiscountAmount));
      const lineProfit = Number(sessionItem?.profit ?? (lineTotal - (Number(item.brand.costPrice || 0) * item.quantity)));

      subtotal += lineSubtotal;
      discountAmount += lineDiscountAmount;
      totalProfit += lineProfit;
      item.brand.quantity -= item.quantity;

      billItems.push({
        name: sessionItem?.name || item.brand.name,
        quantity: item.quantity,
        price: Number(sessionItem?.price ?? item.brand.price),
        costPrice: Number(sessionItem?.costPrice ?? item.brand.costPrice),
        category: sessionItem?.category || item.med.category || "General",
        categoryType: sessionItem?.categoryType || "",
        brandType: sessionItem?.brandType || item.brand.brandType || "Branded",
        lineSubtotal,
        discountPercent: Number(sessionItem?.discountPercent || 0),
        discountAmount: lineDiscountAmount,
        total: lineTotal
      });

      await item.med.save();
    }

    const total = Math.max(0, subtotal - discountAmount);
    const invoiceNumber = await buildInvoiceNumber();

    const bill = new Bill({
      items: billItems,
      customer: {
        ...(paymentSession.customer || {}),
        membership: Boolean(paymentSession.customer?.membership ?? paymentSession.customer?.isMember),
        isMember: Boolean(paymentSession.customer?.membership ?? paymentSession.customer?.isMember)
      },
      store: paymentSession.store || {},
      createdBy: {
        userId: req.user.id,
        username: req.user.username || "",
        fullName: req.user.fullName || ""
      },
      subtotalAmount: subtotal,
      discountAmount,
      totalAmount: total,
      totalProfit,
      invoiceNumber,
      paymentReference: paymentSession.paymentReference,
      paymentStatus: "PAID"
    });

    await bill.save();

    paymentSession.status = "BILLED";
    paymentSession.billId = bill._id;
    await paymentSession.save();

    const customerPhone = String(paymentSession.customer?.phone || "").replace(/\D/g, "").trim();
    if (customerPhone.length >= 10) {
      await Customer.findOneAndUpdate(
        { phone: customerPhone },
        {
          $inc: { visit_count: 1 },
          $set: {
            name: String(paymentSession.customer?.name || "").trim(),
            isMember: Boolean(paymentSession.customer?.membership ?? paymentSession.customer?.isMember),
            membership: Boolean(paymentSession.customer?.membership ?? paymentSession.customer?.isMember),
            last_purchase_date: bill.createdAt
          },
          $setOnInsert: {
            phone: customerPhone,
            membershipDiscountPercent: 0,
            notes: ""
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    await recordAudit(req, "bill.create", "bill", bill._id, {
      totalAmount: bill.totalAmount,
      discountAmount: bill.discountAmount,
      totalProfit: bill.totalProfit,
      storeId: bill.store?.storeId || "",
      storeName: bill.store?.storeName || "",
      itemCount: bill.items.length
    });

    res.json({ success: true, totalAmount: total, totalProfit, billId: bill._id, invoiceNumber: bill.invoiceNumber });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to create bill" });
  }
});

router.get("/", async (req, res) => {
  try {
    const filter = req.user.role === "owner"
      ? (req.query.storeId ? { "store.storeId": String(req.query.storeId) } : {})
      : (req.user.storeId ? { "store.storeId": req.user.storeId } : {});
    const bills = await Bill.find(filter).sort({ createdAt: -1 });
    res.json(bills);
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to load bills" });
  }
});

module.exports = router;
