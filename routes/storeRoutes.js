const express = require("express");
const router = express.Router();
const Store = require("../models/Store");
const { requireAuth, requireOwner } = require("../middleware/auth");
const { recordAudit } = require("../utils/audit");

function normalizeText(value) {
  return String(value || "").trim();
}

router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    let stores;
    if (req.user.role === "owner") {
      stores = await Store.find({ isActive: true }).sort({ name: 1 });
    } else if (req.user.storeId) {
      stores = await Store.find({ _id: req.user.storeId, isActive: true }).sort({ name: 1 });
    } else {
      stores = [];
    }
    res.json({ success: true, stores });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to load stores" });
  }
});

router.post("/", requireOwner, async (req, res) => {
  try {
    const name = normalizeText(req.body.name);
    const code = normalizeText(req.body.code);
    const address = normalizeText(req.body.address);
    const phone = normalizeText(req.body.phone);

    if (!name) {
      return res.status(400).json({ success: false, message: "Store name is required" });
    }

    const existing = await Store.findOne({ name });
    if (existing) {
      return res.status(409).json({ success: false, message: "Store already exists" });
    }

    const store = await Store.create({ name, code, address, phone });
    await recordAudit(req, "store.create", "store", store._id, {
      name: store.name,
      code: store.code,
      phone: store.phone
    });
    res.json({ success: true, store });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to create store" });
  }
});

module.exports = router;
