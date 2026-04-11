const mongoose = require("mongoose");

const brandSchema = new mongoose.Schema({
  name: String,
  brandType: {
    type: String,
    default: "Branded"
  },
  price: Number,
  costPrice: Number,
  quantity: Number,
  barcode: String,
  batchNumber: String,
  expiryDate: Date,
  supplier: String
});

const medicineSchema = new mongoose.Schema({
  storeId: {
    type: String,
    default: ""
  },
  storeName: {
    type: String,
    default: ""
  },
  category: {
    type: String,
    default: "General"
  },
  salt: String, // e.g. Paracetamol
  brands: [brandSchema]
});

module.exports = mongoose.model("Medicine", medicineSchema);
