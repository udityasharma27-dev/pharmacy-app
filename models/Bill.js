const mongoose = require("mongoose");

const billSchema = new mongoose.Schema({
  items: [
    {
      name: String,
      quantity: Number,
      price: Number,
      costPrice: Number,
      total: Number
    }
  ],
  customer: {
    phone: {
      type: String,
      default: ""
    },
    name: {
      type: String,
      default: ""
    },
    isMember: {
      type: Boolean,
      default: false
    }
  },
  store: {
    storeId: {
      type: String,
      default: ""
    },
    storeName: {
      type: String,
      default: ""
    }
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
  },
  subtotalAmount: {
    type: Number,
    default: 0
  },
  discountAmount: {
    type: Number,
    default: 0
  },
  totalAmount: Number,
  totalProfit: {
    type: Number,
    default: 0
  },
  paymentStatus: {
    type: String,
    default: "PAID"
  },
  paymentReference: {
    type: String,
    default: ""
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Bill", billSchema);
