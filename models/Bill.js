const mongoose = require("mongoose");

const billSchema = new mongoose.Schema({
  items: [
    {
      name: String,
      quantity: Number,
      price: Number,
      costPrice: Number,
      category: String,
      categoryType: String,
      brandType: String,
      lineSubtotal: Number,
      baseDiscountPercent: Number,
      discountPercent: Number,
      extraDiscountPercent: Number,
      appliedOffers: [
        {
          code: String,
          label: String,
          discountPercent: Number
        }
      ],
      discountAmount: Number,
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
    },
    membership: {
      type: Boolean,
      default: false
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
  invoiceNumber: {
    type: String,
    default: ""
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
