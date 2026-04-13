const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const { requireAuth } = require("../middleware/auth");
const { recordAudit } = require("../utils/audit");
const { normalizeOrderSource, normalizeCustomerAppStatus } = require("../services/commerceMode");

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
      isMember: !!(customer?.membership ?? customer?.isMember),
      membership: !!(customer?.membership ?? customer?.isMember),
      visit_count: Number(customer?.visit_count || 0),
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
    const membership = Boolean(req.body.membership ?? req.body.isMember);
    const visit_count = Math.max(0, Number(req.body.visit_count || 0) || 0);
    const last_purchase_date = req.body.last_purchase_date ? new Date(req.body.last_purchase_date) : null;
    const acquisitionSource = normalizeOrderSource(req.body.acquisitionSource);
    const lastOrderSource = req.body.lastOrderSource ? normalizeOrderSource(req.body.lastOrderSource) : "";
    const appStatus = normalizeCustomerAppStatus(req.body.appStatus);
    const linkedUserId = String(req.body.linkedUserId || "").trim();

    if (!phone || phone.length < 10) {
      return res.status(400).json({ success: false, message: "Enter a valid phone number" });
    }

    if (!Number.isFinite(membershipDiscountPercent) || membershipDiscountPercent < 0 || membershipDiscountPercent > 100) {
      return res.status(400).json({ success: false, message: "Discount percent must be between 0 and 100" });
    }

    if (req.body.last_purchase_date && Number.isNaN(last_purchase_date?.getTime())) {
      return res.status(400).json({ success: false, message: "Last purchase date is invalid" });
    }

    const existing = await Customer.findOne({ phone }).lean();
    const customer = await Customer.findOneAndUpdate(
      { phone },
      {
        phone,
        name,
        notes,
        isMember: membership,
        membership,
        visit_count,
        last_purchase_date,
        membershipDiscountPercent,
        linkedUserId,
        appStatus,
        acquisitionSource,
        lastOrderSource
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await recordAudit(req, existing ? "customer.update" : "customer.create", "customer", customer._id, {
      phone: customer.phone,
      membership: customer.membership,
      visit_count: customer.visit_count,
      membershipDiscountPercent: customer.membershipDiscountPercent,
      appStatus: customer.appStatus,
      acquisitionSource: customer.acquisitionSource,
      lastOrderSource: customer.lastOrderSource
    });

    res.json({ success: true, customer });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to save customer" });
  }
});

module.exports = router;
