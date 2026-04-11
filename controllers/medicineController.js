const Medicine = require("../models/Medicine");

exports.addMedicine = async (req,res)=>{
  const med = new Medicine(req.body);
  await med.save();
  res.send("Added");
};

exports.getMedicines = async (req,res)=>{
  const data = await Medicine.find();
  res.json(data);
};

exports.updateStock = async (req,res)=>{
  const {id, quantity} = req.body;
  const med = await Medicine.findById(id);

  med.quantity += quantity;
  await med.save();

  res.send("Stock updated");
};