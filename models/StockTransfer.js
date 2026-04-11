const mongoose = require("mongoose");

const stockTransferSchema = new mongoose.Schema({
  fromStore: {
    storeId: {
      type: String,
      default: ""
    },
    storeName: {
      type: String,
      default: ""
    }
  },
  toStore: {
    storeId: {
      type: String,
      default: ""
    },
    storeName: {
      type: String,
      default: ""
    }
  },
  medicine: {
    sourceMedicineId: {
      type: String,
      default: ""
    },
    salt: {
      type: String,
      default: ""
    },
    category: {
      type: String,
      default: "General"
    }
  },
  brand: {
    sourceBrandId: {
      type: String,
      default: ""
    },
    name: {
      type: String,
      default: ""
    },
    brandType: {
      type: String,
      default: "Branded"
    },
    supplier: {
      type: String,
      default: ""
    },
    price: {
      type: Number,
      default: 0
    },
    costPrice: {
      type: Number,
      default: 0
    },
    barcode: {
      type: String,
      default: ""
    },
    batchNumber: {
      type: String,
      default: ""
    },
    expiryDate: {
      type: Date,
      default: null
    }
  },
  quantity: {
    type: Number,
    required: true
  },
  note: {
    type: String,
    default: ""
  },
  createdBy: {
    userId: {
      type: String,
      default: ""
    },
    username: {
      type: String,
      default: ""
    },
    fullName: {
      type: String,
      default: ""
    }
  }
}, { timestamps: true });

stockTransferSchema.index({ createdAt: -1 });
stockTransferSchema.index({ "fromStore.storeId": 1, createdAt: -1 });
stockTransferSchema.index({ "toStore.storeId": 1, createdAt: -1 });

module.exports = mongoose.model("StockTransfer", stockTransferSchema);
