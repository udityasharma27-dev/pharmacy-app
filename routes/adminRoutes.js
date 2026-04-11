const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Store = require("../models/Store");
const Medicine = require("../models/Medicine");
const Bill = require("../models/Bill");
const Customer = require("../models/Customer");
const PaymentSession = require("../models/PaymentSession");
const AuditLog = require("../models/AuditLog");
const { requireAuth, requireOwner } = require("../middleware/auth");
const { recordAudit } = require("../utils/audit");

function pickUserFields(user) {
  return {
    username: user.username,
    passwordHash: user.passwordHash,
    role: user.role,
    fullName: user.fullName || "",
    phone: user.phone || "",
    jobTitle: user.jobTitle || "",
    storeId: user.storeId || "",
    storeName: user.storeName || "",
    baseSalary: Number(user.baseSalary || 0),
    monthlyPatientThreshold: Number(user.monthlyPatientThreshold || 0),
    bonusPerExtraPatient: Number(user.bonusPerExtraPatient || 0),
    isActive: Boolean(user.isActive),
    joiningDate: user.joiningDate || new Date(),
    attendance: Array.isArray(user.attendance) ? user.attendance : [],
    salaryCredits: Array.isArray(user.salaryCredits) ? user.salaryCredits : []
  };
}

router.use(requireAuth, requireOwner);

router.get("/backup/export", async (req, res) => {
  try {
    const [users, stores, medicines, bills, customers, paymentSessions] = await Promise.all([
      User.find().lean(),
      Store.find().lean(),
      Medicine.find().lean(),
      Bill.find().lean(),
      Customer.find().lean(),
      PaymentSession.find().lean()
    ]);

    const backup = {
      exportedAt: new Date().toISOString(),
      version: 1,
      data: {
        users: users.map(pickUserFields),
        stores,
        medicines,
        bills,
        customers,
        paymentSessions
      }
    };

    await recordAudit(req, "backup.export", "backup", "database", {
      userCount: backup.data.users.length,
      storeCount: backup.data.stores.length,
      medicineCount: backup.data.medicines.length,
      billCount: backup.data.bills.length,
      customerCount: backup.data.customers.length,
      paymentSessionCount: backup.data.paymentSessions.length
    });

    res.json({ success: true, backup });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to export backup" });
  }
});

router.post("/backup/import", async (req, res) => {
  try {
    const mode = String(req.body.mode || "merge").trim().toLowerCase();
    const backup = req.body.backup;

    if (!backup || typeof backup !== "object" || !backup.data) {
      return res.status(400).json({ success: false, message: "Backup payload is required" });
    }

    const users = Array.isArray(backup.data.users) ? backup.data.users : [];
    const stores = Array.isArray(backup.data.stores) ? backup.data.stores : [];
    const medicines = Array.isArray(backup.data.medicines) ? backup.data.medicines : [];
    const bills = Array.isArray(backup.data.bills) ? backup.data.bills : [];
    const customers = Array.isArray(backup.data.customers) ? backup.data.customers : [];
    const paymentSessions = Array.isArray(backup.data.paymentSessions) ? backup.data.paymentSessions : [];

    if (!["merge", "replace"].includes(mode)) {
      return res.status(400).json({ success: false, message: "Import mode must be merge or replace" });
    }

    if (mode === "replace") {
      await Promise.all([
        User.deleteMany({}),
        Store.deleteMany({}),
        Medicine.deleteMany({}),
        Bill.deleteMany({}),
        Customer.deleteMany({}),
        PaymentSession.deleteMany({})
      ]);
    }

    for (const user of users) {
      if (!user?.username || !user?.passwordHash) continue;
      await User.findOneAndUpdate(
        { username: user.username },
        { ...pickUserFields(user), passwordHash: user.passwordHash },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    for (const store of stores) {
      if (!store?.name) continue;
      await Store.findOneAndUpdate(
        { name: store.name },
        {
          name: store.name,
          code: store.code || "",
          address: store.address || "",
          phone: store.phone || "",
          isActive: store.isActive !== false
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    for (const customer of customers) {
      if (!customer?.phone) continue;
      await Customer.findOneAndUpdate(
        { phone: customer.phone },
        {
          name: customer.name || "",
          phone: customer.phone,
          isMember: Boolean(customer.isMember),
          membershipDiscountPercent: Number(customer.membershipDiscountPercent || 0),
          notes: customer.notes || ""
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    for (const medicine of medicines) {
      if (!medicine?.salt) continue;
      await Medicine.findOneAndUpdate(
        { salt: medicine.salt, storeId: String(medicine.storeId || "") },
        {
          storeId: String(medicine.storeId || ""),
          storeName: medicine.storeName || "",
          category: medicine.category || "General",
          salt: medicine.salt,
          brands: Array.isArray(medicine.brands) ? medicine.brands : []
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    if (mode === "replace") {
      if (bills.length) await Bill.insertMany(bills.map(({ _id, ...item }) => item), { ordered: false }).catch(() => {});
      if (paymentSessions.length) await PaymentSession.insertMany(paymentSessions.map(({ _id, ...item }) => item), { ordered: false }).catch(() => {});
    }

    await recordAudit(req, "backup.import", "backup", "database", {
      mode,
      userCount: users.length,
      storeCount: stores.length,
      medicineCount: medicines.length,
      customerCount: customers.length,
      billCount: bills.length,
      paymentSessionCount: paymentSessions.length
    });

    res.json({
      success: true,
      message: `Backup imported in ${mode} mode`,
      counts: {
        users: users.length,
        stores: stores.length,
        medicines: medicines.length,
        customers: customers.length,
        bills: bills.length,
        paymentSessions: paymentSessions.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to import backup" });
  }
});

router.get("/audit-logs", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to load audit logs" });
  }
});

module.exports = router;
