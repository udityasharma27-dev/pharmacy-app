const express = require("express");
const router = express.Router();
const PaymentSession = require("../models/PaymentSession");
const { requireAuth } = require("../middleware/auth");

router.use(requireAuth);

router.post("/session", async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const provider = String(req.body.provider || "manual-upi").trim() || "manual-upi";
    const customer = req.body.customer || {};
    const store = {
      storeId: String(req.body.store?.storeId || req.user.storeId || "").trim(),
      storeName: String(req.body.store?.storeName || req.user.storeName || "").trim()
    };

    if (!items.length) {
      return res.status(400).json({ success: false, message: "Cart is empty" });
    }

    const subtotalAmount = items.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    );
    const discountPercent = Number(customer.membershipDiscountPercent || 0);
    const discountAmount = subtotalAmount * (discountPercent / 100);
    const totalAmount = Math.max(0, subtotalAmount - discountAmount);

    const session = await PaymentSession.create({
      userId: req.user.id,
      store,
      items,
      customer: {
        phone: String(customer.phone || "").trim(),
        name: String(customer.name || "").trim(),
        isMember: Boolean(customer.isMember),
        membershipDiscountPercent: discountPercent
      },
      subtotalAmount,
      discountAmount,
      totalAmount,
      provider
    });

    res.json({
      success: true,
      sessionId: String(session._id),
      status: session.status,
      totalAmount: session.totalAmount,
      subtotalAmount: session.subtotalAmount,
      discountAmount: session.discountAmount
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

// Demo/testing endpoint. Replace this with a real provider webhook or payment verification callback.
router.post("/session/:id/mock-success", async (req, res) => {
  try {
    const session = await PaymentSession.findById(req.params.id);

    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ success: false, message: "Payment session not found" });
    }

    if (session.status === "BILLED") {
      return res.status(400).json({ success: false, message: "Bill already generated" });
    }

    session.status = "PAID";
    session.paymentReference = String(req.body.paymentReference || "").trim() || `DEMO-${Date.now()}`;
    await session.save();

    res.json({
      success: true,
      status: session.status,
      paymentReference: session.paymentReference
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to update payment status" });
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
