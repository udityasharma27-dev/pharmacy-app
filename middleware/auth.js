const User = require("../models/User");
const { verifyToken } = require("../utils/auth");

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const session = verifyToken(token);

  if (!session) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const user = await User.findById(session.id);

    if (!user || user.isActive === false) {
      return res.status(401).json({ success: false, message: "User not found" });
    }

    req.user = {
      id: String(user._id),
      username: user.username,
      role: user.role,
      fullName: user.fullName || "",
      storeId: user.storeId || "",
      storeName: user.storeName || ""
    };
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to verify session" });
  }
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
