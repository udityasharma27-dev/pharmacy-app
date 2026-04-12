const Customer = require("../models/Customer");
const ReminderLog = require("../models/ReminderLog");
const { sendSms } = require("./smsService");

const REMINDER_MESSAGE = "Sir, aapka next purchase par extra discount ready hai";
const REMINDER_TYPE = "purchase-followup";
const REMINDER_GAP_DAYS = 10;

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "").trim();
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getCutoffDate(now = new Date()) {
  const date = startOfDay(now);
  date.setDate(date.getDate() - REMINDER_GAP_DAYS);
  return date;
}

function buildCycleKey(lastPurchaseDate) {
  const date = new Date(lastPurchaseDate);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

async function processEligibleReminder(customer) {
  const phone = normalizePhone(customer.phone);
  const cycleKey = buildCycleKey(customer.last_purchase_date);

  if (!phone || !cycleKey) {
    return { status: "skipped", reason: "Customer does not have a valid reminder identity" };
  }

  const existing = await ReminderLog.findOne({
    phone,
    reminderType: REMINDER_TYPE,
    cycleKey
  }).lean();

  if (existing) {
    return { status: "duplicate", reason: "Reminder already sent for this purchase cycle" };
  }

  const delivery = await sendSms({
    to: phone,
    message: REMINDER_MESSAGE
  });

  if (delivery.status !== "sent") {
    return {
      status: delivery.status,
      skipped: Boolean(delivery.skipped),
      reason: delivery.reason || "",
      phone
    };
  }

  await ReminderLog.create({
    phone,
    customerName: String(customer.name || "").trim(),
    reminderType: REMINDER_TYPE,
    cycleKey,
    lastPurchaseDate: customer.last_purchase_date,
    message: REMINDER_MESSAGE,
    delivery: {
      provider: String(delivery.provider || ""),
      status: "sent",
      externalId: String(delivery.externalId || ""),
      response: delivery.response || null
    },
    sentAt: new Date()
  });

  return {
    status: delivery.status,
    skipped: Boolean(delivery.skipped),
    reason: delivery.reason || "",
    phone
  };
}

async function runDailyReminderCycle(now = new Date()) {
  const cutoffDate = getCutoffDate(now);
  const customers = await Customer.find({
    phone: { $exists: true, $ne: "" },
    last_purchase_date: { $ne: null, $lte: cutoffDate }
  }).lean();

  const summary = {
    checkedAt: new Date(now),
    eligibleCustomers: customers.length,
    sent: 0,
    skipped: 0,
    duplicates: 0,
    failed: 0
  };

  for (const customer of customers) {
    try {
      const result = await processEligibleReminder(customer);
      if (result.status === "sent") summary.sent += 1;
      else if (result.status === "duplicate") summary.duplicates += 1;
      else summary.skipped += 1;
    } catch (error) {
      summary.failed += 1;
      console.error("Reminder send failed", {
        phone: customer.phone,
        message: error.message
      });
    }
  }

  return summary;
}

module.exports = {
  REMINDER_GAP_DAYS,
  REMINDER_MESSAGE,
  runDailyReminderCycle,
  buildCycleKey,
  getCutoffDate
};
