require("dotenv").config();

const mongoose = require("mongoose");
const Store = require("../models/Store");
const Medicine = require("../models/Medicine");

const STARTER_MEDICINES = [
  {
    category: "Pain Relief",
    salt: "Paracetamol",
    brands: [
      { name: "Dolo 650", brandType: "Branded", price: 32, costPrice: 24, supplier: "Sun Pharma" },
      { name: "Paracip 650", brandType: "Generic", price: 24, costPrice: 18, supplier: "Cipla Wholesale" }
    ]
  },
  {
    category: "Pain Relief",
    salt: "Ibuprofen",
    brands: [
      { name: "Brufen 400", brandType: "Branded", price: 28, costPrice: 21, supplier: "Abbott" },
      { name: "Ibugesic 400", brandType: "Branded", price: 30, costPrice: 22, supplier: "Cipla Wholesale" }
    ]
  },
  {
    category: "Pain Relief",
    salt: "Aceclofenac",
    brands: [
      { name: "Zerodol", brandType: "Branded", price: 82, costPrice: 66, supplier: "Ipca" },
      { name: "Hifenac", brandType: "Branded", price: 88, costPrice: 70, supplier: "Intas" }
    ]
  },
  {
    category: "Pain Relief",
    salt: "Diclofenac",
    brands: [
      { name: "Voveran", brandType: "Branded", price: 62, costPrice: 49, supplier: "Novartis Distributor" },
      { name: "Diclomol", brandType: "Generic", price: 48, costPrice: 36, supplier: "Mankind" }
    ]
  },
  {
    category: "Fever & Cold",
    salt: "Cetirizine",
    brands: [
      { name: "Cetzine", brandType: "Branded", price: 22, costPrice: 16, supplier: "Dr Reddy's" },
      { name: "Okacet", brandType: "Branded", price: 18, costPrice: 13, supplier: "Cipla Wholesale" }
    ]
  },
  {
    category: "Fever & Cold",
    salt: "Levocetirizine",
    brands: [
      { name: "Xyzal", brandType: "Branded", price: 44, costPrice: 33, supplier: "UCB" },
      { name: "LCZ", brandType: "Generic", price: 32, costPrice: 24, supplier: "Macleods" }
    ]
  },
  {
    category: "Fever & Cold",
    salt: "Montelukast",
    brands: [
      { name: "Montair", brandType: "Branded", price: 98, costPrice: 79, supplier: "Cipla Wholesale" },
      { name: "Montek LC", brandType: "Branded", price: 112, costPrice: 88, supplier: "Sun Pharma" }
    ]
  },
  {
    category: "Fever & Cold",
    salt: "Phenylephrine + Chlorpheniramine + Paracetamol",
    brands: [
      { name: "Sinarest", brandType: "Branded", price: 46, costPrice: 35, supplier: "Centaur" },
      { name: "Wikoryl", brandType: "Branded", price: 49, costPrice: 38, supplier: "Alembic" }
    ]
  },
  {
    category: "Antibiotics",
    salt: "Amoxicillin + Clavulanate",
    brands: [
      { name: "Augmentin 625", brandType: "Branded", price: 220, costPrice: 182, supplier: "GSK" },
      { name: "Moxikind CV 625", brandType: "Branded", price: 198, costPrice: 161, supplier: "Mankind" }
    ]
  },
  {
    category: "Antibiotics",
    salt: "Azithromycin",
    brands: [
      { name: "Azee 500", brandType: "Branded", price: 118, costPrice: 95, supplier: "Cipla Wholesale" },
      { name: "Azax 500", brandType: "Generic", price: 96, costPrice: 76, supplier: "Macleods" }
    ]
  },
  {
    category: "Antibiotics",
    salt: "Cefixime",
    brands: [
      { name: "Taxim-O 200", brandType: "Branded", price: 146, costPrice: 118, supplier: "Alkem" },
      { name: "Mahacef 200", brandType: "Branded", price: 138, costPrice: 110, supplier: "Mankind" }
    ]
  },
  {
    category: "Antibiotics",
    salt: "Doxycycline",
    brands: [
      { name: "Doxicip", brandType: "Generic", price: 46, costPrice: 34, supplier: "Cipla Wholesale" },
      { name: "Doxt-SL", brandType: "Branded", price: 52, costPrice: 40, supplier: "Dr Reddy's" }
    ]
  },
  {
    category: "Diabetes",
    salt: "Metformin",
    brands: [
      { name: "Glyciphage 500", brandType: "Branded", price: 34, costPrice: 25, supplier: "Franco-Indian" },
      { name: "Metlong 500", brandType: "Generic", price: 28, costPrice: 20, supplier: "Micro Labs" }
    ]
  },
  {
    category: "Diabetes",
    salt: "Glimepiride",
    brands: [
      { name: "Amaryl 1", brandType: "Branded", price: 122, costPrice: 98, supplier: "Sanofi" },
      { name: "Glimisave 1", brandType: "Generic", price: 74, costPrice: 58, supplier: "Eris" }
    ]
  },
  {
    category: "Diabetes",
    salt: "Teneligliptin",
    brands: [
      { name: "Tenepride 20", brandType: "Branded", price: 138, costPrice: 112, supplier: "Mankind" },
      { name: "Tenglyn", brandType: "Generic", price: 126, costPrice: 102, supplier: "Macleods" }
    ]
  },
  {
    category: "Blood Pressure",
    salt: "Amlodipine",
    brands: [
      { name: "Amlong 5", brandType: "Branded", price: 52, costPrice: 39, supplier: "Micro Labs" },
      { name: "Amlokind 5", brandType: "Branded", price: 56, costPrice: 43, supplier: "Mankind" }
    ]
  },
  {
    category: "Blood Pressure",
    salt: "Telmisartan",
    brands: [
      { name: "Telma 40", brandType: "Branded", price: 168, costPrice: 136, supplier: "Glenmark" },
      { name: "Telsartan 40", brandType: "Generic", price: 132, costPrice: 104, supplier: "Dr Reddy's" }
    ]
  },
  {
    category: "Blood Pressure",
    salt: "Losartan",
    brands: [
      { name: "Repace 50", brandType: "Branded", price: 98, costPrice: 79, supplier: "Sun Pharma" },
      { name: "Losacar 50", brandType: "Branded", price: 102, costPrice: 82, supplier: "Torrent" }
    ]
  },
  {
    category: "Cardiac Care",
    salt: "Atorvastatin",
    brands: [
      { name: "Atorva 10", brandType: "Branded", price: 92, costPrice: 72, supplier: "Zydus" },
      { name: "Tonact 10", brandType: "Branded", price: 108, costPrice: 86, supplier: "Lupin" }
    ]
  },
  {
    category: "Cardiac Care",
    salt: "Rosuvastatin",
    brands: [
      { name: "Rosuvas 10", brandType: "Branded", price: 114, costPrice: 91, supplier: "Sun Pharma" },
      { name: "Roseday 10", brandType: "Branded", price: 126, costPrice: 102, supplier: "Dr Reddy's" }
    ]
  },
  {
    category: "Digestive Care",
    salt: "Pantoprazole",
    brands: [
      { name: "Pantocid 40", brandType: "Branded", price: 112, costPrice: 89, supplier: "Sun Pharma" },
      { name: "Pantop 40", brandType: "Branded", price: 104, costPrice: 83, supplier: "Aristo" }
    ]
  },
  {
    category: "Digestive Care",
    salt: "Rabeprazole",
    brands: [
      { name: "Rablet 20", brandType: "Branded", price: 128, costPrice: 102, supplier: "Lupin" },
      { name: "Rabonik 20", brandType: "Generic", price: 92, costPrice: 72, supplier: "Cipla Wholesale" }
    ]
  },
  {
    category: "Digestive Care",
    salt: "Ondansetron",
    brands: [
      { name: "Ondem 4", brandType: "Branded", price: 38, costPrice: 28, supplier: "Alkem" },
      { name: "Emeset 4", brandType: "Branded", price: 42, costPrice: 31, supplier: "Cipla Wholesale" }
    ]
  },
  {
    category: "Digestive Care",
    salt: "Domperidone",
    brands: [
      { name: "Domstal", brandType: "Branded", price: 54, costPrice: 42, supplier: "Torrent" },
      { name: "Motinorm", brandType: "Branded", price: 58, costPrice: 45, supplier: "Sun Pharma" }
    ]
  },
  {
    category: "Respiratory",
    salt: "Ambroxol",
    brands: [
      { name: "Mucolite", brandType: "Branded", price: 62, costPrice: 48, supplier: "Dr Reddy's" },
      { name: "Ambrolite", brandType: "Generic", price: 48, costPrice: 36, supplier: "Leeford" }
    ]
  },
  {
    category: "Respiratory",
    salt: "Salbutamol",
    brands: [
      { name: "Asthalin", brandType: "Branded", price: 34, costPrice: 25, supplier: "Cipla Wholesale" },
      { name: "Salbair", brandType: "Generic", price: 28, costPrice: 20, supplier: "Glenmark" }
    ]
  },
  {
    category: "Respiratory",
    salt: "Budesonide",
    brands: [
      { name: "Budecort Respules", brandType: "Branded", price: 156, costPrice: 128, supplier: "Cipla Wholesale" },
      { name: "Pulmicort", brandType: "Branded", price: 172, costPrice: 142, supplier: "AstraZeneca Distributor" }
    ]
  },
  {
    category: "Vitamins & Supplements",
    salt: "Multivitamin",
    brands: [
      { name: "A to Z NS", brandType: "Branded", price: 132, costPrice: 106, supplier: "Alkem" },
      { name: "Revital H", brandType: "Branded", price: 148, costPrice: 121, supplier: "Sun Pharma" }
    ]
  },
  {
    category: "Vitamins & Supplements",
    salt: "Vitamin D3",
    brands: [
      { name: "Uprise D3 60K", brandType: "Branded", price: 98, costPrice: 78, supplier: "Alkem" },
      { name: "Calcirol 60K", brandType: "Generic", price: 84, costPrice: 66, supplier: "Cadila" }
    ]
  },
  {
    category: "Vitamins & Supplements",
    salt: "Calcium + Vitamin D3",
    brands: [
      { name: "Shelcal 500", brandType: "Branded", price: 128, costPrice: 102, supplier: "Torrent" },
      { name: "Calcigen D3", brandType: "Generic", price: 96, costPrice: 74, supplier: "Macleods" }
    ]
  },
  {
    category: "Women Care",
    salt: "Iron + Folic Acid",
    brands: [
      { name: "Autrin", brandType: "Branded", price: 46, costPrice: 35, supplier: "Pfizer Distributor" },
      { name: "Livogen", brandType: "Branded", price: 54, costPrice: 41, supplier: "Abbott" }
    ]
  },
  {
    category: "Skin Care",
    salt: "Clotrimazole",
    brands: [
      { name: "Candid Cream", brandType: "Branded", price: 92, costPrice: 74, supplier: "Glenmark" },
      { name: "Canesten", brandType: "Branded", price: 98, costPrice: 78, supplier: "Bayer" }
    ]
  },
  {
    category: "Skin Care",
    salt: "Mupirocin",
    brands: [
      { name: "T-Bact", brandType: "Branded", price: 116, costPrice: 92, supplier: "Glaxo" },
      { name: "Mupinase", brandType: "Generic", price: 102, costPrice: 81, supplier: "Micro Labs" }
    ]
  },
  {
    category: "Eye Care",
    salt: "Carboxymethylcellulose",
    brands: [
      { name: "Refresh Tears", brandType: "Branded", price: 178, costPrice: 146, supplier: "Allergan" },
      { name: "Lubistar", brandType: "Generic", price: 142, costPrice: 114, supplier: "Sun Pharma" }
    ]
  },
  {
    category: "Eye Care",
    salt: "Moxifloxacin",
    brands: [
      { name: "Moxicip Eye Drops", brandType: "Branded", price: 148, costPrice: 121, supplier: "Cipla Wholesale" },
      { name: "Vigamox", brandType: "Branded", price: 162, costPrice: 132, supplier: "Alcon" }
    ]
  },
  {
    category: "Children Care",
    salt: "Paracetamol Suspension",
    brands: [
      { name: "Crocin Drops", brandType: "Branded", price: 34, costPrice: 25, supplier: "GSK" },
      { name: "Calpol 250", brandType: "Branded", price: 38, costPrice: 29, supplier: "Glaxo" }
    ]
  },
  {
    category: "Children Care",
    salt: "Cefixime Suspension",
    brands: [
      { name: "Taxim-O Dry Syrup", brandType: "Branded", price: 122, costPrice: 98, supplier: "Alkem" },
      { name: "Mahacef Dry Syrup", brandType: "Branded", price: 116, costPrice: 93, supplier: "Mankind" }
    ]
  },
  {
    category: "Women Care",
    salt: "Dydrogesterone",
    brands: [
      { name: "Duphaston", brandType: "Branded", price: 598, costPrice: 512, supplier: "Abbott" },
      { name: "Dydrosave", brandType: "Generic", price: 482, costPrice: 406, supplier: "Eris" }
    ]
  },
  {
    category: "Emergency",
    salt: "ORS",
    brands: [
      { name: "Electral", brandType: "Branded", price: 24, costPrice: 17, supplier: "FDC" },
      { name: "Orsl", brandType: "Generic", price: 18, costPrice: 12, supplier: "Leeford" }
    ]
  },
  {
    category: "Emergency",
    salt: "Povidone Iodine",
    brands: [
      { name: "Betadine", brandType: "Branded", price: 86, costPrice: 68, supplier: "Win Medicare" },
      { name: "Povikem", brandType: "Generic", price: 62, costPrice: 48, supplier: "Leeford" }
    ]
  }
];

function buildBrandSeed(brand, store, medicineIndex, brandIndex) {
  const batchSeed = `${String(store.code || store.name || "STORE").replace(/\s+/g, "").slice(0, 6).toUpperCase()}-${medicineIndex + 1}-${brandIndex + 1}`;
  const quantity = 12 + ((medicineIndex + 1) * 3 + store.name.length + brandIndex * 4) % 48;
  const expiryYear = 2027 + ((medicineIndex + brandIndex) % 2);
  const expiryMonth = String(((medicineIndex + brandIndex) % 12) + 1).padStart(2, "0");
  const expiryDay = String(((medicineIndex + store.name.length) % 27) + 1).padStart(2, "0");

  return {
    name: brand.name,
    brandType: brand.brandType,
    price: brand.price,
    costPrice: brand.costPrice,
    quantity,
    barcode: `${medicineIndex + 1}${brandIndex + 1}${String(store._id).slice(-6)}`.replace(/\D/g, "").slice(0, 12),
    batchNumber: batchSeed,
    expiryDate: new Date(`${expiryYear}-${expiryMonth}-${expiryDay}`),
    supplier: brand.supplier
  };
}

async function seedStoreInventory(store) {
  let addedMedicines = 0;
  let addedBrands = 0;

  for (let medicineIndex = 0; medicineIndex < STARTER_MEDICINES.length; medicineIndex += 1) {
    const item = STARTER_MEDICINES[medicineIndex];
    let medicine = await Medicine.findOne({ salt: item.salt, storeId: String(store._id) });

    if (!medicine) {
      medicine = new Medicine({
        storeId: String(store._id),
        storeName: store.name,
        category: item.category,
        salt: item.salt,
        brands: []
      });
      addedMedicines += 1;
    } else {
      medicine.category = item.category;
      medicine.storeName = store.name;
    }

    item.brands.forEach((brand, brandIndex) => {
      const exists = medicine.brands.some(existing =>
        String(existing.name).toLowerCase() === String(brand.name).toLowerCase() &&
        String(existing.brandType || "Branded") === String(brand.brandType || "Branded")
      );

      if (!exists) {
        medicine.brands.push(buildBrandSeed(brand, store, medicineIndex, brandIndex));
        addedBrands += 1;
      }
    });

    await medicine.save();
  }

  return { addedMedicines, addedBrands };
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing in .env");
  }

  await mongoose.connect(process.env.MONGO_URI);
  const stores = await Store.find({ isActive: true }).sort({ createdAt: 1, name: 1 });

  if (!stores.length) {
    console.log("No active stores found. Add your stores first, then run the seed again.");
    return;
  }

  console.log(`Seeding starter inventory into ${stores.length} store(s)...`);

  for (const store of stores) {
    const result = await seedStoreInventory(store);
    console.log(`${store.name}: added ${result.addedMedicines} medicines and ${result.addedBrands} brands`);
  }

  console.log(`Starter inventory ready. Catalog size: ${STARTER_MEDICINES.length} salts per store.`);
}

main()
  .catch(error => {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
