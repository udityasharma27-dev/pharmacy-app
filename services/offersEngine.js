function normalizeDay(value) {
  return new Date(value).getDay();
}

function roundPercent(value) {
  return Number(Number(value || 0).toFixed(2));
}

function evaluateOfferRules({ customer, baseDiscountPercent, offerConfig, now = new Date() }) {
  const appliedOffers = [];
  const config = offerConfig || {};
  const isMember = Boolean(customer?.membership ?? customer?.isMember);

  if (config.mondayMemberOffer?.enabled && isMember && normalizeDay(now) === 1) {
    const extraDiscountPercent = roundPercent(config.mondayMemberOffer.extraDiscountPercent || 0);
    if (extraDiscountPercent > 0) {
      appliedOffers.push({
        code: "MONDAY_MEMBER",
        label: "Monday Member Offer",
        discountPercent: extraDiscountPercent
      });
    }
  }

  if (config.globalOffer?.enabled) {
    const globalDiscountPercent = roundPercent(config.globalOffer.discountPercent || 0);
    if (globalDiscountPercent > 0) {
      appliedOffers.push({
        code: "GLOBAL",
        label: String(config.globalOffer.label || "Global Offer"),
        discountPercent: globalDiscountPercent
      });
    }
  }

  const extraDiscountPercent = roundPercent(
    appliedOffers.reduce((sum, offer) => sum + Number(offer.discountPercent || 0), 0)
  );
  const finalDiscountPercent = roundPercent(
    Math.min(100, Number(baseDiscountPercent || 0) + extraDiscountPercent)
  );

  return {
    baseDiscountPercent: roundPercent(baseDiscountPercent || 0),
    extraDiscountPercent,
    finalDiscountPercent,
    appliedOffers
  };
}

module.exports = {
  evaluateOfferRules
};
