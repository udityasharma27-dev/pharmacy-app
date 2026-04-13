const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const PaymentSession = require("../models/PaymentSession");
const { requireAuth } = require("../middleware/auth");
const { buildCheckoutPayload } = require("../services/checkoutPricing");

function isManualUpiConfirmationAllowed() {
  return String(process.env.ALLOW_MANUAL_UPI_CONFIRM || "true").trim().toLowerCase() !== "false";
}

router.use(requireAuth);

router.post("/session", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: "Database is not connected yet"
      });
    }

    const payload = await buildCheckoutPayload(req);

    const session = await PaymentSession.create({
      userId: req.user.id,
      ...payload
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
    console.error("Payment session creation failed", {
      message: error?.message,
      stack: error?.stack,
      userId: req.user?.id,
      itemCount: Array.isArray(req.body?.items) ? req.body.items.length : 0,
      provider: req.body?.provider
    });
    const safeMessage = error?.name === "ValidationError"
      ? "Payment session data is invalid"
      : "Unable to create payment session";
    res.status(500).json({ success: false, message: safeMessage });
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
        source: session.source,
        customerContext: session.customerContext,
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
