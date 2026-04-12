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
  birthDate: {
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
  },
  membershipDiscountPercent: {
    type: Number,
    default: 0
  },
  linkedUserId: {
    type: String,
    default: ""
  },
  appStatus: {
    type: String,
    enum: ["store_only", "invited", "active"],
    default: "store_only"
  },
  acquisitionSource: {
    type: String,
    enum: ["in_store", "online"],
    default: "in_store"
  },
  lastOrderSource: {
    type: String,
    enum: ["", "in_store", "online"],
    default: ""
  },
  notes: {
    type: String,
    default: ""
  }
}, { timestamps: true });

module.exports = mongoose.model("Customer", customerSchema);
