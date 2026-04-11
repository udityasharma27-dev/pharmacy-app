const AuditLog = require("../models/AuditLog");

function getRequestIp(req) {
  const forwardedFor = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwardedFor || req?.ip || "";
}

async function recordAudit(req, action, entityType, entityId = "", details = {}) {
  try {
    await AuditLog.create({
      actor: {
        userId: String(req?.user?.id || ""),
        username: String(req?.user?.username || ""),
        role: String(req?.user?.role || "")
      },
      action,
      entityType,
      entityId: String(entityId || ""),
      details,
      ipAddress: getRequestIp(req)
    });
  } catch (error) {
    console.error("Audit log failed", error);
  }
}

module.exports = {
  recordAudit
};
