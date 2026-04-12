const mongoose = require("mongoose");

const offerConfigSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    default: "default"
  },
  mondayMemberOffer: {
    enabled: {
      type: Boolean,
      default: true
    },
    extraDiscountPercent: {
      type: Number,
      default: 3
    }
  },
  globalOffer: {
    enabled: {
      type: Boolean,
      default: false
    },
    discountPercent: {
      type: Number,
      default: 0
    },
    label: {
      type: String,
      default: "Global Offer"
    }
  },
  updatedBy: {
    userId: {
      type: String,
      default: ""
    },
    username: {
      type: String,
      default: ""
    }
  }
}, { timestamps: true });

module.exports = mongoose.model("OfferConfig", offerConfigSchema);
