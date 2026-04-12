const OfferConfig = require("../models/OfferConfig");

function clampPercent(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), 100);
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizeConfig(config = {}) {
  return {
    key: "default",
    mondayMemberOffer: {
      enabled: config.mondayMemberOffer?.enabled !== false,
      extraDiscountPercent: clampPercent(config.mondayMemberOffer?.extraDiscountPercent, 3)
    },
    globalOffer: {
      enabled: Boolean(config.globalOffer?.enabled),
      discountPercent: clampPercent(config.globalOffer?.discountPercent, 0),
      label: normalizeText(config.globalOffer?.label, "Global Offer")
    },
    updatedBy: {
      userId: String(config.updatedBy?.userId || ""),
      username: String(config.updatedBy?.username || "")
    }
  };
}

async function getOfferConfig() {
  const existing = await OfferConfig.findOne({ key: "default" });

  if (existing) {
    return normalizeConfig(existing.toObject());
  }

  const created = await OfferConfig.create(normalizeConfig());
  return normalizeConfig(created.toObject());
}

async function updateOfferConfig(input, actor = {}) {
  const current = await getOfferConfig();
  const next = normalizeConfig({
    ...current,
    mondayMemberOffer: {
      ...current.mondayMemberOffer,
      ...(input?.mondayMemberOffer || {})
    },
    globalOffer: {
      ...current.globalOffer,
      ...(input?.globalOffer || {})
    },
    updatedBy: {
      userId: String(actor.userId || ""),
      username: String(actor.username || "")
    }
  });

  const saved = await OfferConfig.findOneAndUpdate(
    { key: "default" },
    next,
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return normalizeConfig(saved.toObject());
}

module.exports = {
  getOfferConfig,
  updateOfferConfig
};
