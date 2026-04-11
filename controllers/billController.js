const Medicine = require("../models/Medicine");
const Bill = require("../models/Bill");

exports.createBill = async (req,res)=>{
  try {
    const items = req.body.items;

    let total = 0;
    let billItems = [];

    for (let item of items) {
      const med = await Medicine.findById(item.id);

      if(!med) return res.status(400).send("Medicine not found");

      if(med.quantity < item.quantity){
        return res.status(400).send("Not enough stock");
      }

      let cost = med.price * item.quantity;
      total += cost;

      med.quantity -= item.quantity;
      await med.save();

      billItems.push({
        medicineId: med._id,
        name: med.name,
        quantity: item.quantity,
        price: med.price,
        total: cost
      });
    }

    const bill = new Bill({
      items: billItems,
      totalAmount: total
    });

    await bill.save();

    res.json({ totalAmount: total });

  } catch (err) {
    res.status(500).send("Error ❌");
  }
};

exports.getBills = async (req,res)=>{
  const bills = await Bill.find().sort({createdAt:-1});
  res.json(bills);
};