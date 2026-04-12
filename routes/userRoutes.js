const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Bill = require("../models/Bill");
const Customer = require("../models/Customer");
const Store = require("../models/Store");
const { createToken, hashPassword, verifyPassword, verifyToken } = require("../utils/auth");
const { requireAuth, requireOwner } = require("../middleware/auth");
const { recordAudit } = require("../utils/audit");
const { normalizeCustomerAppStatus } = require("../services/commerceMode");
const { buildCustomerPassword, buildCustomerPasswordVariants, buildCustomerUsername, normalizeBirthDate } = require("../services/customerCredentials");
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map();

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "").trim();
}

function normalizeUsernameInput(value) {
  const text = normalizeText(value);
  const phone = normalizePhone(text);
  return phone.length >= 10 ? phone : text;
}

function parseMoney(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getLoginAttemptState(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    const fresh = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(key, fresh);
    return fresh;
  }
  return entry;
}

function recordFailedLogin(key) {
  const entry = getLoginAttemptState(key);
  entry.count += 1;
  loginAttempts.set(key, entry);
}

function clearFailedLogin(key) {
  loginAttempts.delete(key);
}

function getLoginKey(req, username) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwardedFor || req.ip || "unknown";
  return `${ip}:${String(username || "").toLowerCase()}`;
}

function currentMonthWindow(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return { start, end, monthKey };
}

function patientKeyForBill(bill) {
  const phone = normalizePhone(bill.customer?.phone);
  return phone || `walk-in:${bill._id}`;
}

function getAttendanceSummary(user, monthStart, monthEnd) {
  const summary = { present: 0, absent: 0, leave: 0 };
  const entries = (user.attendance || []).filter(entry => {
    const date = new Date(entry.date);
    return date >= monthStart && date < monthEnd;
  });

  const latestPerDay = new Map();
  entries.forEach(entry => {
    const key = new Date(entry.date).toISOString().slice(0, 10);
    latestPerDay.set(key, entry);
  });

  latestPerDay.forEach(entry => {
    const status = entry.status || "present";
    summary[status] = (summary[status] || 0) + 1;
  });

  return {
    ...summary,
    totalMarkedDays: latestPerDay.size
  };
}

function sanitizeUser(user, metrics = null) {
  return {
    id: String(user._id),
    username: user.username,
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
    joiningDate: user.joiningDate,
    attendance: user.attendance || [],
    salaryCredits: user.salaryCredits || [],
    metrics
  };
}

async function buildUserMetrics(user) {
  const { start, end, monthKey } = currentMonthWindow();
  const bills = await Bill.find({
    "createdBy.userId": String(user._id),
    createdAt: { $gte: start, $lt: end }
  }).lean();

  const uniquePatients = new Set(bills.map(patientKeyForBill));
  const patientsThisMonth = uniquePatients.size;
  const threshold = Number(user.monthlyPatientThreshold || 0);
  const bonusPerExtraPatient = Number(user.bonusPerExtraPatient || 0);
  const extraPatients = Math.max(0, patientsThisMonth - threshold);
  const bonusEarned = extraPatients * bonusPerExtraPatient;
  const salaryCreditsThisMonth = (user.salaryCredits || []).filter(item => item.monthKey === monthKey);
  const salaryCreditedThisMonth = salaryCreditsThisMonth.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const attendanceSummary = getAttendanceSummary(user, start, end);

  return {
    monthKey,
    patientsThisMonth,
    thresholdPatients: threshold,
    extraPatients,
    bonusPerExtraPatient,
    bonusEarned,
    salaryCreditedThisMonth,
    expectedMonthlyPayout: Number(user.baseSalary || 0) + bonusEarned,
    attendanceSummary
  };
}

router.post("/login", async (req, res) => {
  try {
    const username = normalizeUsernameInput(req.body.username);
    const password = String(req.body.password || "");
    const loginKey = getLoginKey(req, username);
    const attempts = getLoginAttemptState(loginKey);

    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password are required" });
    }

    if (attempts.count >= LOGIN_MAX_ATTEMPTS) {
      return res.status(429).json({ success: false, message: "Too many login attempts. Please wait and try again." });
    }

    const user = await User.findOne({ username });

    if (!user) {
      recordFailedLogin(loginKey);
      return res.status(401).json({ success: false, message: "Invalid username or password" });
    }

    let passwordMatches = verifyPassword(password, user.passwordHash);

    if (!passwordMatches && user.role === "customer") {
      passwordMatches = buildCustomerPasswordVariants(user.fullName, user.birthDate).includes(password);
      if (passwordMatches && !user.passwordHash) {
        user.passwordHash = hashPassword(password);
        await user.save();
      }
    }

    if (!passwordMatches && user.password === password) {
      user.passwordHash = hashPassword(password);
      user.password = undefined;
      await user.save();
      passwordMatches = true;
    }

    if (!passwordMatches) {
      recordFailedLogin(loginKey);
      return res.status(401).json({ success: false, message: "Invalid username or password" });
    }

    clearFailedLogin(loginKey);
    const token = createToken(user);

    res.json({
      success: true,
      role: user.role,
      token,
      user: sanitizeUser(user)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Login failed" });
  }
});

router.post("/customer-signup", async (req, res) => {
  try {
    const fullName = normalizeText(req.body.fullName);
    const phone = normalizePhone(req.body.phone);
    const birthDate = normalizeBirthDate(req.body.birthDate);
    const username = buildCustomerUsername(phone);
    const password = buildCustomerPassword(fullName, birthDate);

    if (!fullName || !phone || !birthDate) {
      return res.status(400).json({
        success: false,
        message: "Full name, phone number, and birth date are required."
      });
    }

    if (phone.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid phone number."
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Unable to generate a password from the provided details."
      });
    }

    const existing = await User.findOne({ username });

    if (existing && existing.role !== "customer") {
      return res.status(409).json({
        success: false,
        message: "That phone number is already in use by another account."
      });
    }

    const user = existing && existing.role === "customer"
      ? existing
      : new User({
        username,
        role: "customer",
        jobTitle: "Customer"
      });

    user.username = username;
    user.passwordHash = hashPassword(password);
    user.role = "customer";
    user.fullName = fullName;
    user.phone = phone;
    user.birthDate = birthDate;
    user.jobTitle = "Customer";
    user.isActive = true;
    await user.save();

    const customer = await Customer.findOneAndUpdate(
      { phone },
      {
        $set: {
          name: fullName,
          birthDate,
          linkedUserId: String(user._id),
          appStatus: normalizeCustomerAppStatus("active"),
          acquisitionSource: "online"
        }
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      }
    );

    await recordAudit(req, "user.customer-signup", "user", user._id, {
      username: user.username,
      phone: user.phone,
      linkedCustomerId: customer ? String(customer._id) : "",
      appStatus: customer?.appStatus || "active"
    });

    const token = createToken(user);

    res.json({
      success: true,
      role: user.role,
      token,
      user: sanitizeUser(user),
      credentials: {
        username,
        passwordRule: "Use your phone number as username. Password can be full name plus birth date in YYYYMMDD format, or birth date plus full name."
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to create customer account" });
  }
});

router.post("/logout", (req, res) => {
  res.json({ success: true });
});

router.get("/me", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const session = verifyToken(token);

  if (!session) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const user = await User.findById(session.id);

  if (!user) {
    return res.status(401).json({ success: false, message: "User not found" });
  }

  const metrics = await buildUserMetrics(user);

  res.json({
    success: true,
    user: sanitizeUser(user, metrics)
  });
});

router.use(requireAuth);

router.get("/", requireOwner, async (req, res) => {
  try {
    const users = await User.find().sort({ role: 1, fullName: 1, username: 1 });
    const payload = [];

    for (const user of users) {
      payload.push(sanitizeUser(user, await buildUserMetrics(user)));
    }

    res.json({ success: true, users: payload });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to load users" });
  }
});

router.post("/", requireOwner, async (req, res) => {
  try {
    const username = normalizeText(req.body.username);
    const password = String(req.body.password || "");
    const fullName = normalizeText(req.body.fullName);
    const phone = normalizePhone(req.body.phone);
    const jobTitle = normalizeText(req.body.jobTitle);
    const storeId = normalizeText(req.body.storeId);
    const baseSalary = parseMoney(req.body.baseSalary, 0);
    const monthlyPatientThreshold = parseMoney(req.body.monthlyPatientThreshold, 0);
    const bonusPerExtraPatient = parseMoney(req.body.bonusPerExtraPatient, 0);
    const role = normalizeText(req.body.role) === "owner" ? "owner" : "worker";

    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password are required" });
    }

    const existing = await User.findOne({ username });

    if (existing) {
      return res.status(409).json({ success: false, message: "Username already exists" });
    }

    let storeName = "";
    if (storeId) {
      const store = await Store.findById(storeId);
      if (!store) {
        return res.status(400).json({ success: false, message: "Selected store was not found" });
      }
      storeName = store.name;
    }

    const user = await User.create({
      username,
      passwordHash: hashPassword(password),
      role,
      fullName,
      phone,
      jobTitle,
      storeId,
      storeName,
      baseSalary,
      monthlyPatientThreshold,
      bonusPerExtraPatient,
      joiningDate: req.body.joiningDate ? new Date(req.body.joiningDate) : new Date()
    });

    await recordAudit(req, "user.create", "user", user._id, {
      username: user.username,
      role: user.role,
      storeId: user.storeId,
      storeName: user.storeName
    });

    res.json({
      success: true,
      user: sanitizeUser(user, await buildUserMetrics(user))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to create user" });
  }
});

router.post("/:id/attendance", requireOwner, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: "Staff account not found" });
    }

    const status = ["present", "absent", "leave"].includes(req.body.status) ? req.body.status : "present";
    const note = normalizeText(req.body.note);
    const date = req.body.date ? new Date(req.body.date) : new Date();

    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ success: false, message: "Attendance date is invalid" });
    }

    const dayKey = date.toISOString().slice(0, 10);
    const existing = (user.attendance || []).find(entry => new Date(entry.date).toISOString().slice(0, 10) === dayKey);

    if (existing) {
      existing.status = status;
      existing.note = note;
      existing.markedByUserId = req.user.id;
    } else {
      user.attendance.push({ date, status, note, markedByUserId: req.user.id });
    }

    await user.save();

    res.json({
      success: true,
      user: sanitizeUser(user, await buildUserMetrics(user))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to save attendance" });
  }
});

router.post("/:id/salary-credit", requireOwner, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: "Staff account not found" });
    }

    const amount = parseMoney(req.body.amount, -1);
    const note = normalizeText(req.body.note);
    const monthKey = normalizeText(req.body.monthKey) || currentMonthWindow().monthKey;

    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ success: false, message: "Enter a valid salary amount" });
    }

    user.salaryCredits.push({
      monthKey,
      amount,
      note,
      creditedByUserId: req.user.id,
      creditedAt: new Date()
    });

    await user.save();

    res.json({
      success: true,
      user: sanitizeUser(user, await buildUserMetrics(user))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to credit salary" });
  }
});

module.exports = router;
