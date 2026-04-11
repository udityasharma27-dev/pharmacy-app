const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  actor: {
    userId: {
      type: String,
      default: ""
    },
    username: {
      type: String,
      default: ""
    },
    role: {
      type: String,
      default: ""
    }
  },
  action: {
    type: String,
    required: true
  },
  entityType: {
    type: String,
    required: true
  },
  entityId: {
    type: String,
    default: ""
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  ipAddress: {
    type: String,
    default: ""
  }
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
