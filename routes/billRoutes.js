const express = require("express");
const router = express.Router();
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
    const billItems = [];

    for (const item of preparedItems) {
      const cost = item.brand.price * item.quantity;
      const profit = (item.brand.price - item.brand.costPrice) * item.quantity;
      subtotal += cost;
      totalProfit += profit;
      item.brand.quantity -= item.quantity;

      billItems.push({
        name: item.brand.name,
        quantity: item.quantity,
        price: item.brand.price,
        costPrice: item.brand.costPrice,
        total: cost
      });

      await item.med.save();
    }

    const discountAmount = Number(paymentSession.discountAmount || 0);
    const total = Math.max(0, subtotal - discountAmount);
    const invoiceNumber = await buildInvoiceNumber();

    const bill = new Bill({
      items: billItems,
      customer: paymentSession.customer || {},
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

    await recordAudit(req, "bill.create", "bill", bill._id, {
      totalAmount: bill.totalAmount,
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
