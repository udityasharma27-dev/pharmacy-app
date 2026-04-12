const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ["present", "absent", "leave"],
    default: "present"
  },
  note: {
    type: String,
    default: ""
  },
  markedByUserId: {
    type: String,
    default: ""
  }
}, { _id: true });

const salaryCreditSchema = new mongoose.Schema({
  monthKey: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true,
    default: 0
  },
  note: {
    type: String,
    default: ""
  },
  creditedAt: {
    type: Date,
    default: Date.now
  },
  creditedByUserId: {
    type: String,
    default: ""
  }
}, { _id: true });

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: String,
  passwordHash: String,
  role: {
    type: String,
    enum: ["owner", "worker", "customer"],
    default: "worker"
  },
  fullName: {
    type: String,
    default: ""
  },
  phone: {
    type: String,
    default: ""
  },
  birthDate: {
    type: String,
    default: ""
  },
  jobTitle: {
    type: String,
    default: ""
  },
  storeId: {
    type: String,
    default: ""
  },
  storeName: {
    type: String,
    default: ""
  },
  baseSalary: {
    type: Number,
    default: 0
  },
  monthlyPatientThreshold: {
    type: Number,
    default: 0
  },
  bonusPerExtraPatient: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  joiningDate: {
    type: Date,
    default: Date.now
  },
  attendance: {
    type: [attendanceSchema],
    default: []
  },
  salaryCredits: {
    type: [salaryCreditSchema],
    default: []
  }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
