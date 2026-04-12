const mongoose = require("mongoose");

const reminderLogSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    index: true
  },
  customerName: {
    type: String,
    default: ""
  },
  reminderType: {
    type: String,
    default: "purchase-followup",
    index: true
  },
  cycleKey: {
    type: String,
    required: true
  },
  lastPurchaseDate: {
    type: Date,
    default: null
  },
  message: {
    type: String,
    default: ""
  },
  delivery: {
    provider: {
      type: String,
      default: ""
    },
    status: {
      type: String,
      enum: ["sent", "skipped", "failed"],
      default: "skipped"
    },
    externalId: {
      type: String,
      default: ""
    },
    response: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    }
  },
  sentAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

reminderLogSchema.index({ phone: 1, reminderType: 1, cycleKey: 1 }, { unique: true });
reminderLogSchema.index({ sentAt: -1 });

module.exports = mongoose.model("ReminderLog", reminderLogSchema);
