const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const { requireAuth } = require("../middleware/auth");
const { recordAudit } = require("../utils/audit");

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "").trim();
}

router.use(requireAuth);

router.get("/lookup/:phone", async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);

    if (!phone || phone.length < 10) {
      return res.status(400).json({ success: false, message: "Enter a valid phone number" });
    }

    const customer = await Customer.findOne({ phone });

    res.json({
      success: true,
      customer: customer || null,
      isMember: !!customer?.isMember,
      discountPercent: Number(customer?.membershipDiscountPercent || 0)
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to lookup customer" });
  }
});

router.post("/", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const name = String(req.body.name || "").trim();
    const notes = String(req.body.notes || "").trim();
    const membershipDiscountPercent = Number(req.body.membershipDiscountPercent || 0);
    const isMember = Boolean(req.body.isMember);

    if (!phone || phone.length < 10) {
      return res.status(400).json({ success: false, message: "Enter a valid phone number" });
    }

    if (!Number.isFinite(membershipDiscountPercent) || membershipDiscountPercent < 0 || membershipDiscountPercent > 100) {
      return res.status(400).json({ success: false, message: "Discount percent must be between 0 and 100" });
    }

    const existing = await Customer.findOne({ phone }).lean();
    const customer = await Customer.findOneAndUpdate(
      { phone },
      { phone, name, notes, isMember, membershipDiscountPercent },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await recordAudit(req, existing ? "customer.update" : "customer.create", "customer", customer._id, {
      phone: customer.phone,
      isMember: customer.isMember,
      membershipDiscountPercent: customer.membershipDiscountPercent
    });

    res.json({ success: true, customer });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to save customer" });
  }
});

module.exports = router;
