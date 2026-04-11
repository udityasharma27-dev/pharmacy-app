const crypto = require("crypto");
const DEFAULT_TOKEN_SECRET = "pharmacy-app-secret";

function getTokenSecret() {
  return process.env.TOKEN_SECRET || DEFAULT_TOKEN_SECRET;
}

function getTokenTtlMs() {
  const hours = Number(process.env.TOKEN_TTL_HOURS || 168);
  return Number.isFinite(hours) && hours > 0 ? hours * 60 * 60 * 1000 : 168 * 60 * 60 * 1000;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedValue) {
  if (!storedValue || !storedValue.includes(":")) {
    return false;
  }

  const [salt, storedHash] = storedValue.split(":");
  const hashBuffer = crypto.scryptSync(password, salt, 64);
  const storedBuffer = Buffer.from(storedHash, "hex");

  if (hashBuffer.length !== storedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(hashBuffer, storedBuffer);
}

function createToken(user) {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    id: String(user._id || user.id),
    username: user.username,
    role: user.role,
    fullName: user.fullName || "",
    storeId: user.storeId || "",
    storeName: user.storeName || "",
    iat: now,
    exp: now + getTokenTtlMs()
  })).toString("base64url");

  const signature = crypto
    .createHmac("sha256", getTokenSecret())
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [payload, signature] = token.split(".");
  const expectedSignature = crypto
    .createHmac("sha256", getTokenSecret())
    .update(payload)
    .digest("base64url");

  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.id || !parsed?.exp || Date.now() > Number(parsed.exp)) {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken
};
