const express = require("express");
const router = express.Router();
const Medicine = require("../models/Medicine");
const Store = require("../models/Store");
const { requireAuth, requireOwner } = require("../middleware/auth");
const { recordAudit } = require("../utils/audit");

function normalizeText(value) {
  return String(value || "").trim();
}

function parseNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function validateBrandInput(brand) {
  const name = normalizeText(brand?.name);
  const brandType = normalizeText(brand?.brandType) || "Branded";
  const price = parseNonNegativeNumber(brand?.price);
  const costPrice = parseNonNegativeNumber(brand?.costPrice);
  const quantity = parseNonNegativeNumber(brand?.quantity);
  const barcode = normalizeText(brand?.barcode);
  const batchNumber = normalizeText(brand?.batchNumber);
  const supplier = normalizeText(brand?.supplier);
  const expiryDate = brand?.expiryDate ? new Date(brand.expiryDate) : null;

  if (!name) {
    return { error: "Brand name is required" };
  }

  if (price === null || costPrice === null || quantity === null) {
    return { error: "Price, cost price, and quantity must be non-negative numbers" };
  }

  if (brand?.expiryDate && Number.isNaN(expiryDate?.getTime())) {
    return { error: "Expiry date is invalid" };
  }

  return {
    value: {
      name,
      brandType: brandType === "Generic" ? "Generic" : "Branded",
      price,
      costPrice,
      quantity,
      barcode,
      batchNumber,
      supplier,
      expiryDate
    }
  };
}

async function resolveStoreForRequest(req) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const query = req.query && typeof req.query === "object" ? req.query : {};
  const requestedStoreId = normalizeText(body.storeId || query.storeId);

  if (req.user.role !== "owner") {
    return {
      storeId: req.user.storeId || "",
      storeName: req.user.storeName || ""
    };
  }

  if (!requestedStoreId) {
    return { storeId: "", storeName: "" };
  }

  const store = await Store.findById(requestedStoreId);
  return store ? { storeId: String(store._id), storeName: store.name } : null;
}

router.use(requireAuth);

// ADD BRAND
router.post("/", requireOwner, async (req, res) => {
  try {
    const salt = normalizeText(req.body.salt);
    const category = normalizeText(req.body.category) || "General";
    const { error, value: brand } = validateBrandInput(req.body.brand);

    if (!salt) {
      return res.status(400).json({ success: false, message: "Salt is required" });
    }

    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const store = await resolveStoreForRequest(req);
    if (store === null) {
      return res.status(400).json({ success: false, message: "Store not found" });
    }

    let med = await Medicine.findOne({ salt, storeId: store.storeId });
    const isNewMedicine = !med;

    if (!med) {
      med = new Medicine({ salt, category, storeId: store.storeId, storeName: store.storeName, brands: [brand] });
    } else {
      med.category = category;
      const existingBrand = med.brands.find(
        item =>
          item.name.toLowerCase() === brand.name.toLowerCase() &&
          (item.brandType || "Branded") === brand.brandType
      );

      if (existingBrand) {
        return res.status(409).json({
          success: false,
          message: "Brand already exists for this salt"
        });
      }

      med.brands.push(brand);
    }

    await med.save();
    await recordAudit(req, isNewMedicine ? "medicine.create" : "medicine.add-brand", "medicine", med._id, {
      salt: med.salt,
      storeId: med.storeId,
      storeName: med.storeName,
      brandName: brand.name,
      brandType: brand.brandType
    });
    res.json({ success: true, message: "Medicine added" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to add medicine" });
  }
});

// GET ALL
router.get("/", async (req, res) => {
  try {
    const store = await resolveStoreForRequest(req);
    if (store === null) {
      return res.status(400).json({ success: false, message: "Store not found" });
    }
    const filter = store.storeId ? { storeId: store.storeId } : {};
    const data = await Medicine.find(filter).sort({ category: 1, salt: 1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to load medicines" });
  }
});

// UPDATE STOCK
router.put("/:id/:brandId", requireOwner, async (req, res) => {
  try {
    const quantity = Number(req.body.quantity);

    if (!Number.isFinite(quantity) || quantity === 0) {
      return res.status(400).json({ success: false, message: "Quantity must be a non-zero number" });
    }

    const med = await Medicine.findById(req.params.id);

    if (!med) {
      return res.status(404).json({ success: false, message: "Medicine not found" });
    }

    const brand = med.brands.id(req.params.brandId);

    if (!brand) {
      return res.status(404).json({ success: false, message: "Brand not found" });
    }

    if (brand.quantity + quantity < 0) {
      return res.status(400).json({ success: false, message: "Stock cannot go below zero" });
    }

    brand.quantity += quantity;

    await med.save();
    await recordAudit(req, "medicine.adjust-stock", "medicine", med._id, {
      salt: med.salt,
      brandId: brand._id,
      brandName: brand.name,
      delta: quantity,
      quantity: brand.quantity
    });
    res.json({ success: true, message: "Stock updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to update stock" });
  }
});

// EDIT BRAND
router.patch("/:id/:brandId", requireOwner, async (req, res) => {
  try {
    const med = await Medicine.findById(req.params.id);

    if (!med) {
      return res.status(404).json({ success: false, message: "Medicine not found" });
    }

    const brand = med.brands.id(req.params.brandId);

    if (!brand) {
      return res.status(404).json({ success: false, message: "Brand not found" });
    }

    const nextSalt = normalizeText(req.body.salt || med.salt);
    const nextCategory = normalizeText(req.body.category || med.category) || "General";
    const { error, value } = validateBrandInput(req.body);

    if (!nextSalt) {
      return res.status(400).json({ success: false, message: "Salt is required" });
    }

    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    med.salt = nextSalt;
    med.category = nextCategory;
    brand.name = value.name;
    brand.brandType = value.brandType;
    brand.price = value.price;
    brand.costPrice = value.costPrice;
    brand.quantity = value.quantity;
    brand.barcode = value.barcode;
    brand.batchNumber = value.batchNumber;
    brand.supplier = value.supplier;
    brand.expiryDate = value.expiryDate;

    await med.save();
    await recordAudit(req, "medicine.update-brand", "medicine", med._id, {
      salt: med.salt,
      brandId: brand._id,
      brandName: brand.name
    });
    res.json({ success: true, message: "Brand updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to update brand" });
  }
});

// DELETE BRAND
router.delete("/:id/:brandId", requireOwner, async (req, res) => {
  try {
    const med = await Medicine.findById(req.params.id);

    if (!med) {
      return res.status(404).json({ success: false, message: "Medicine not found" });
    }

    const brand = med.brands.id(req.params.brandId);

    if (!brand) {
      return res.status(404).json({ success: false, message: "Brand not found" });
    }

    const brandName = brand.name;
    brand.deleteOne();
    await med.save();
    await recordAudit(req, "medicine.delete-brand", "medicine", med._id, {
      salt: med.salt,
      brandId: req.params.brandId,
      brandName
    });

    res.json({ success: true, message: "Brand deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to delete brand" });
  }
});

// DELETE MEDICINE
router.delete("/:id", requireOwner, async (req, res) => {
  try {
    const deletedMedicine = await Medicine.findByIdAndDelete(req.params.id);

    if (!deletedMedicine) {
      return res.status(404).json({ success: false, message: "Medicine not found" });
    }

    await recordAudit(req, "medicine.delete", "medicine", deletedMedicine._id, {
      salt: deletedMedicine.salt,
      storeId: deletedMedicine.storeId,
      storeName: deletedMedicine.storeName
    });
    res.json({ success: true, message: "Medicine deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to delete medicine" });
  }
});

module.exports = router;
