require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");
const Store = require("../models/Store");

async function main() {
  const username = String(process.argv[2] || "staff").trim();
  const storeName = String(process.argv[3] || "clinic").trim();

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing in .env");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const user = await User.findOne({ username });
  if (!user) {
    throw new Error(`User '${username}' not found`);
  }

  const store = await Store.findOne({ name: new RegExp(`^${storeName}$`, "i"), isActive: true });
  if (!store) {
    throw new Error(`Store '${storeName}' not found`);
  }

  user.role = "worker";
  user.storeId = String(store._id);
  user.storeName = store.name;
  if (!user.jobTitle) user.jobTitle = "Store Worker";
  await user.save();

  console.log(`Assigned ${username} to ${store.name} as worker.`);
}

main()
  .catch(error => {
    console.error("Assignment failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
