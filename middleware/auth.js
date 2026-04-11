const { verifyToken } = require("../utils/auth");

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const user = verifyToken(token);

  if (!user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  req.user = user;
  next();
}

function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== "owner") {
    return res.status(403).json({ success: false, message: "Owner access required" });
  }

  next();
}

module.exports = {
  requireAuth,
  requireOwner
};
