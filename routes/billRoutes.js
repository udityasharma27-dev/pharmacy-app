const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Customer = require("../models/Customer");
const Medicine = require("../models/Medicine");
const Bill = require("../models/Bill");
const PaymentSession = require("../models/PaymentSession");
const { requireAuth } = require("../middleware/auth");
const { recordAudit } = require("../utils/audit");
const { normalizeOrderSource, normalizeCustomerContext } = require("../services/commerceMode");

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

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "").trim();
}

async function findAccessibleBillById(billId, user, session = null) {
  if (!mongoose.Types.ObjectId.isValid(String(billId || ""))) {
    return null;
  }

  const query = Bill.findById(billId);
  if (session) query.session(session);
  const bill = await query;

  if (!bill) {
    return null;
  }

  if (user.role === "owner") {
    return bill;
  }

  if (!user.storeId || String(bill.store?.storeId || "") !== String(user.storeId)) {
    return null;
  }

  return bill;
}

function isTransactionUnsupported(error) {
  const message = String(error?.message || "");
  return message.includes("Transaction numbers are only allowed")
    || message.includes("replica set")
    || message.includes("Transaction")
    || error?.codeName === "IllegalOperation";
}

async function createBillFromPaymentSession(paymentSession, req, dbSession = null) {
  const items = Array.isArray(paymentSession.items) ? paymentSession.items : [];

  if (items.length === 0) {
    return { status: 400, body: { success: false, message: "Cart is empty" } };
  }

  const mergedItems = new Map();

  for (const item of items) {
    const key = `${item.medId}:${item.brandId}`;
    const quantity = Number(item.quantity);

    if (!item.medId || !item.brandId || !Number.isInteger(quantity) || quantity <= 0) {
      return {
        status: 400,
        body: {
          success: false,
          message: "Each cart item must include a medicine, brand, and positive quantity"
        }
      };
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
    const medicineQuery = Medicine.findById(item.medId);
    if (dbSession) medicineQuery.session(dbSession);
    const med = await medicineQuery;

    if (!med) {
      return { status: 404, body: { success: false, message: "Medicine not found" } };
    }

    const brand = med.brands.id(item.brandId);

    if (!brand) {
      return { status: 404, body: { success: false, message: "Brand not found" } };
    }

    if (brand.quantity < quantity) {
      return {
        status: 400,
        body: {
          success: false,
          message: `Not enough stock for ${brand.name}`
        }
      };
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
      baseDiscountPercent: Number(sessionItem?.baseDiscountPercent || 0),
      discountPercent: Number(sessionItem?.discountPercent || 0),
      extraDiscountPercent: Number(sessionItem?.extraDiscountPercent || 0),
      appliedOffers: Array.isArray(sessionItem?.appliedOffers) ? sessionItem.appliedOffers : [],
      discountAmount: lineDiscountAmount,
      total: lineTotal
    });
  }

  const total = Math.max(0, subtotal - discountAmount);
  const invoiceNumber = await buildInvoiceNumber();

  const bill = new Bill({
    items: billItems,
    source: normalizeOrderSource(paymentSession.source),
    customerContext: normalizeCustomerContext(paymentSession.customerContext),
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

  if (dbSession) {
    await bill.save({ session: dbSession });
  } else {
    await bill.save();
  }

  for (const item of preparedItems) {
    if (dbSession) {
      await item.med.save({ session: dbSession });
    } else {
      await item.med.save();
    }
  }

  paymentSession.status = "BILLED";
  paymentSession.billId = bill._id;
  if (dbSession) {
    await paymentSession.save({ session: dbSession });
  } else {
    await paymentSession.save();
  }

  const customerPhone = normalizePhone(paymentSession.customer?.phone);
  if (customerPhone.length >= 10) {
    const update = {
      $inc: { visit_count: 1 },
      $set: {
        name: String(paymentSession.customer?.name || "").trim(),
        isMember: Boolean(paymentSession.customer?.membership ?? paymentSession.customer?.isMember),
        membership: Boolean(paymentSession.customer?.membership ?? paymentSession.customer?.isMember),
        last_purchase_date: bill.createdAt,
        lastOrderSource: bill.source
      },
      $setOnInsert: {
        phone: customerPhone,
        membershipDiscountPercent: 0,
        acquisitionSource: bill.source,
        appStatus: "store_only",
        notes: ""
      }
    };

    const customerQuery = Customer.findOneAndUpdate(
      { phone: customerPhone },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (dbSession) customerQuery.session(dbSession);
    await customerQuery;
  }

  return {
    status: 200,
    body: {
      success: true,
      totalAmount: total,
      totalProfit,
      billId: bill._id,
      invoiceNumber: bill.invoiceNumber,
      source: bill.source,
      customerContext: bill.customerContext
    },
    audit: {
      entityId: bill._id,
      totalAmount: bill.totalAmount,
      discountAmount: bill.discountAmount,
      totalProfit: bill.totalProfit,
      storeId: bill.store?.storeId || "",
      storeName: bill.store?.storeName || "",
      itemCount: bill.items.length,
      source: bill.source,
      customerContext: bill.customerContext
    }
  };
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
    let result;
    let dbSession = null;

    try {
      dbSession = await mongoose.startSession();
      await dbSession.withTransaction(async () => {
        const paymentSessionInTxn = await PaymentSession.findById(paymentSessionId).session(dbSession);

        if (!paymentSessionInTxn || paymentSessionInTxn.userId !== req.user.id) {
          result = { status: 404, body: { success: false, message: "Payment session not found" } };
          throw new Error("abort-transaction");
        }

        if (paymentSessionInTxn.status !== "PAID") {
          result = {
            status: 400,
            body: {
              success: false,
              message: "Bill can only be generated after successful payment"
            }
          };
          throw new Error("abort-transaction");
        }

        if (paymentSessionInTxn.billId) {
          const existingBill = await Bill.findById(paymentSessionInTxn.billId).session(dbSession);
          result = {
            status: 200,
            body: {
              success: true,
              subtotalAmount: existingBill?.subtotalAmount || paymentSessionInTxn.subtotalAmount || paymentSessionInTxn.totalAmount,
              discountAmount: existingBill?.discountAmount || paymentSessionInTxn.discountAmount || 0,
              totalAmount: existingBill?.totalAmount || paymentSessionInTxn.totalAmount,
              totalProfit: existingBill?.totalProfit || 0,
              billId: paymentSessionInTxn.billId,
              invoiceNumber: existingBill?.invoiceNumber || ""
            }
          };
          return;
        }

        result = await createBillFromPaymentSession(paymentSessionInTxn, req, dbSession);
      });
    } catch (error) {
      if (error.message === "abort-transaction" && result) {
        return res.status(result.status).json(result.body);
      }

      if (!isTransactionUnsupported(error)) {
        throw error;
      }
    } finally {
      if (dbSession) {
        await dbSession.endSession();
      }
    }

    if (!result) {
      result = await createBillFromPaymentSession(paymentSession, req, null);
    }

    if (result.status === 200 && result.audit) {
      await recordAudit(req, "bill.create", "bill", result.audit.entityId, {
        totalAmount: result.audit.totalAmount,
        discountAmount: result.audit.discountAmount,
        totalProfit: result.audit.totalProfit,
        storeId: result.audit.storeId,
        storeName: result.audit.storeName,
        itemCount: result.audit.itemCount,
        source: result.audit.source,
        customerContext: result.audit.customerContext
      });
    }

    return res.status(result.status).json(result.body);
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to create bill" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const bill = await findAccessibleBillById(req.params.id, req.user);

    if (!bill) {
      return res.status(404).json({ success: false, message: "Bill not found" });
    }

    res.json({ success: true, bill });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to load bill" });
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
