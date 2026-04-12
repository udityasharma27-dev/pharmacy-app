const mongoose = require("mongoose");

const paymentSessionSchema = new mongoose.Schema({
  userId: String,
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
  items: [
    {
      medId: String,
      brandId: String,
      name: String,
      price: Number,
      costPrice: Number,
      quantity: Number,
      category: String,
      categoryType: String,
      brandType: String,
      lineSubtotal: Number,
      discountPercent: Number,
      discountAmount: Number,
      total: Number,
      profit: Number
    }
  ],
  totalAmount: Number,
  subtotalAmount: {
    type: Number,
    default: 0
  },
  discountAmount: {
    type: Number,
    default: 0
  },
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
    },
    membership: {
      type: Boolean,
      default: false
    },
    membershipDiscountPercent: {
      type: Number,
      default: 0
    },
    visit_count: {
      type: Number,
      default: 0
    },
    last_purchase_date: {
      type: Date,
      default: null
    }
  },
  status: {
    type: String,
    enum: ["PENDING", "PAID", "FAILED", "BILLED"],
    default: "PENDING"
  },
  provider: {
    type: String,
    default: "manual-upi"
  },
  paymentReference: {
    type: String,
    default: ""
  },
  billId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Bill",
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model("PaymentSession", paymentSessionSchema);
