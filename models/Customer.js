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
