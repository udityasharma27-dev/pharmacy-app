require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const User = require("./models/User");
const { hashPassword } = require("./utils/auth");

const app = express();
const PORT = Number(process.env.PORT || 5000);
const OWNER_USERNAME = process.env.OWNER_USERNAME || "admin";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "123";
const STAFF_USERNAME = process.env.STAFF_USERNAME || "staff";
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || "123";

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ROUTES
const userRoutes = require("./routes/userRoutes");
const medicineRoutes = require("./routes/medicineRoutes");
const billRoutes = require("./routes/billRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const customerRoutes = require("./routes/customerRoutes");
const storeRoutes = require("./routes/storeRoutes");

app.use("/users", userRoutes);
app.use("/medicines", medicineRoutes);
app.use("/bills", billRoutes);
app.use("/payments", paymentRoutes);
app.use("/customers", customerRoutes);
app.use("/stores", storeRoutes);

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.get("/health", (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbConnected = dbState === 1;
  res.status(dbConnected ? 200 : 503).json({
    ok: dbConnected,
    dbConnected,
    uptimeSeconds: Math.round(process.uptime())
  });
});

async function ensureDefaultUsers() {
  const userCount = await User.countDocuments();

  if (userCount > 0) {
    return;
  }

  await User.insertMany([
    { username: OWNER_USERNAME, passwordHash: hashPassword(OWNER_PASSWORD), role: "owner", fullName: "Pharmacy Owner", jobTitle: "Owner" },
    { username: STAFF_USERNAME, passwordHash: hashPassword(STAFF_PASSWORD), role: "worker", fullName: "Staff Member", jobTitle: "Staff" }
  ]);

  console.log("Default users created");
}

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("DB Connected");
    await ensureDefaultUsers();
  })
  .catch(err => {
    console.error("Mongo connection failed", err);
    process.exit(1);
  });

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
