const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    default: ""
  },
  phone: {
    type: String,
    required: true,
    unique: true
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
  },
  membershipDiscountPercent: {
    type: Number,
    default: 0
  },
  notes: {
    type: String,
    default: ""
  }
}, { timestamps: true });

module.exports = mongoose.model("Customer", customerSchema);
