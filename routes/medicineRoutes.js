const express = require("express");
const router = express.Router();
const Medicine = require("../models/Medicine");
const Store = require("../models/Store");
const StockTransfer = require("../models/StockTransfer");
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

function sameBrandIdentity(left, right) {
  return normalizeText(left?.name).toLowerCase() === normalizeText(right?.name).toLowerCase()
    && (normalizeText(left?.brandType) || "Branded") === (normalizeText(right?.brandType) || "Branded")
    && normalizeText(left?.barcode) === normalizeText(right?.barcode)
    && normalizeText(left?.batchNumber) === normalizeText(right?.batchNumber);
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

router.get("/transfers", requireOwner, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const transfers = await StockTransfer.find().sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ success: true, transfers });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to load stock transfers" });
  }
});

router.post("/transfer", requireOwner, async (req, res) => {
  try {
    const fromStoreId = normalizeText(req.body.fromStoreId);
    const toStoreId = normalizeText(req.body.toStoreId);
    const medicineId = normalizeText(req.body.medicineId);
    const brandId = normalizeText(req.body.brandId);
    const quantity = Number(req.body.quantity);
    const note = normalizeText(req.body.note);

    if (!fromStoreId || !toStoreId) {
      return res.status(400).json({ success: false, message: "Select both source and destination stores" });
    }

    if (fromStoreId === toStoreId) {
      return res.status(400).json({ success: false, message: "Source and destination stores must be different" });
    }

    if (!medicineId || !brandId) {
      return res.status(400).json({ success: false, message: "Select a medicine and brand to transfer" });
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ success: false, message: "Transfer quantity must be a positive whole number" });
    }

    const [fromStore, toStore, sourceMedicine] = await Promise.all([
      Store.findById(fromStoreId),
      Store.findById(toStoreId),
      Medicine.findById(medicineId)
    ]);

    if (!fromStore || !toStore) {
      return res.status(404).json({ success: false, message: "Selected store was not found" });
    }

    if (!sourceMedicine || String(sourceMedicine.storeId) !== fromStoreId) {
      return res.status(404).json({ success: false, message: "Source medicine was not found in the selected store" });
    }

    const sourceBrand = sourceMedicine.brands.id(brandId);

    if (!sourceBrand) {
      return res.status(404).json({ success: false, message: "Selected brand was not found" });
    }

    if (Number(sourceBrand.quantity || 0) < quantity) {
      return res.status(400).json({ success: false, message: "Not enough stock in the source store" });
    }

    let destinationMedicine = await Medicine.findOne({
      salt: sourceMedicine.salt,
      storeId: String(toStore._id)
    });

    if (!destinationMedicine) {
      destinationMedicine = new Medicine({
        salt: sourceMedicine.salt,
        category: sourceMedicine.category || "General",
        storeId: String(toStore._id),
        storeName: toStore.name,
        brands: []
      });
    }

    destinationMedicine.category = sourceMedicine.category || destinationMedicine.category || "General";
    destinationMedicine.storeName = toStore.name;

    let destinationBrand = destinationMedicine.brands.find(item => sameBrandIdentity(item, sourceBrand));

    if (destinationBrand) {
      destinationBrand.quantity = Number(destinationBrand.quantity || 0) + quantity;
      destinationBrand.price = Number(sourceBrand.price || 0);
      destinationBrand.costPrice = Number(sourceBrand.costPrice || 0);
      destinationBrand.supplier = sourceBrand.supplier || destinationBrand.supplier || "";
      destinationBrand.expiryDate = sourceBrand.expiryDate || destinationBrand.expiryDate || null;
    } else {
      destinationMedicine.brands.push({
        name: sourceBrand.name,
        brandType: sourceBrand.brandType || "Branded",
        price: Number(sourceBrand.price || 0),
        costPrice: Number(sourceBrand.costPrice || 0),
        quantity,
        barcode: sourceBrand.barcode || "",
        batchNumber: sourceBrand.batchNumber || "",
        expiryDate: sourceBrand.expiryDate || null,
        supplier: sourceBrand.supplier || ""
      });
      destinationBrand = destinationMedicine.brands[destinationMedicine.brands.length - 1];
    }

    sourceBrand.quantity = Number(sourceBrand.quantity || 0) - quantity;

    await sourceMedicine.save();
    await destinationMedicine.save();

    const transfer = await StockTransfer.create({
      fromStore: {
        storeId: String(fromStore._id),
        storeName: fromStore.name
      },
      toStore: {
        storeId: String(toStore._id),
        storeName: toStore.name
      },
      medicine: {
        sourceMedicineId: String(sourceMedicine._id),
        salt: sourceMedicine.salt,
        category: sourceMedicine.category || "General"
      },
      brand: {
        sourceBrandId: String(sourceBrand._id),
        name: sourceBrand.name,
        brandType: sourceBrand.brandType || "Branded",
        supplier: sourceBrand.supplier || "",
        price: Number(sourceBrand.price || 0),
        costPrice: Number(sourceBrand.costPrice || 0),
        barcode: sourceBrand.barcode || "",
        batchNumber: sourceBrand.batchNumber || "",
        expiryDate: sourceBrand.expiryDate || null
      },
      quantity,
      note,
      createdBy: {
        userId: req.user.id,
        username: req.user.username || "",
        fullName: req.user.fullName || ""
      }
    });

    await recordAudit(req, "medicine.transfer-stock", "stock-transfer", transfer._id, {
      fromStoreId: String(fromStore._id),
      fromStoreName: fromStore.name,
      toStoreId: String(toStore._id),
      toStoreName: toStore.name,
      salt: sourceMedicine.salt,
      brandName: sourceBrand.name,
      quantity
    });

    res.json({
      success: true,
      message: `Transferred ${quantity} units of ${sourceBrand.name} to ${toStore.name}`,
      transfer
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to transfer stock" });
  }
});

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
