window.addEventListener("pageshow", event => {
  if (event.persisted) {
    window.location.reload();
  }
});

const URL = ensureApiBaseUrl();
const LOW_STOCK_LIMIT = 5;
const NEAR_EXPIRY_DAYS = 45;
const EXPIRY_SOON_DAYS = 30;

let currentUser = null;
let teamProfiles = [];
let stores = [];
let activeStoreId = localStorage.getItem("activeStoreId") || "";
let medicines = [];
let bills = [];
let allBills = [];
let transfers = [];
let transferInventory = [];
let cart = JSON.parse(localStorage.getItem("pharmacyCart") || "[]");
let editState = null;
let selectedCustomer = JSON.parse(localStorage.getItem("selectedCustomer") || "null");
let selectedBillingChoice = null;
let recentBillingItems = JSON.parse(localStorage.getItem("recentBillingItems") || "[]");
let quickQuantityValue = 1;
let formMemory = JSON.parse(localStorage.getItem("inventoryFormMemory") || '{"supplier":"","category":""}');
let isSavingMedicine = false;
let isCreatingStore = false;
let isCreatingStaff = false;
let isLookingUpCustomer = false;
let isSavingMember = false;
let isRefreshingData = false;
let refreshTimer = null;
let isSubmittingTransfer = false;
let hasCompletedInitialRender = false;

if (!localStorage.getItem("token")) window.location.replace(`index.html?t=${Date.now()}`);

function getToken() {
  return localStorage.getItem("token") || "";
}

function setMessage(text, type = "") {
  const box = document.getElementById("message");
  box.className = "message";
  box.textContent = text || "";
  box.style.display = text ? "block" : "none";
  if (text) box.classList.add(type || "success");
}

function hideBrandLoader(delay = 180) {
  const loader = document.getElementById("brandLoader");
  if (!loader) return;
  window.setTimeout(() => loader.classList.add("hidden"), delay);
}

function authHeaders(extra = {}) {
  return { ...extra, Authorization: "Bearer " + getToken() };
}

async function fetchJson(path, options = {}) {
  const response = await fetch(URL + path, {
    ...options,
    cache: "no-store",
    headers: authHeaders(options.headers || {})
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    localStorage.clear();
    window.location.replace(`index.html?t=${Date.now()}`);
    throw new Error("Session expired");
  }
  if (!response.ok) throw new Error(data.message || "Request failed");
  return data;
}

const formatAmount = value => "Rs " + Number(value || 0).toFixed(2);
const formatDate = value => value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "N/A";
const formatDateTime = value => new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const formatInvoiceNumber = bill => bill?.invoiceNumber || `INV-${String(bill?._id || "").slice(-6).toUpperCase()}`;
const saveCart = () => localStorage.setItem("pharmacyCart", JSON.stringify(cart));
const saveCustomer = () => localStorage.setItem("selectedCustomer", JSON.stringify(selectedCustomer));
const isOwner = () => currentUser?.role === "owner";

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const now = new Date();
  const target = new Date(dateValue);
  return Math.ceil((target.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0)) / 86400000);
}

function isToday(value) {
  if (!value) return false;
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function alertState(brand) {
  const qty = Number(brand.quantity || 0);
  const days = daysUntil(brand.expiryDate);
  if (days !== null && days < 0) return { level: "expired", text: "Expired" };
  if (days !== null && days <= NEAR_EXPIRY_DAYS) return { level: "near-expiry", text: "Near expiry" };
  if (qty <= LOW_STOCK_LIMIT) return { level: "low-stock", text: "Low stock" };
  return { level: "healthy", text: "Healthy" };
}

function getChoiceByIds(medicineId, brandId) {
  const medicine = medicines.find(item => item._id === medicineId);
  const brand = medicine?.brands?.find(item => item._id === brandId);
  if (!medicine || !brand) return null;
  return {
    medicineId: medicine._id,
    brandId: brand._id,
    salt: medicine.salt,
    category: medicine.category || "General",
    brandName: brand.name,
    brandType: brand.brandType || "Branded",
    supplier: brand.supplier || "N/A",
    quantity: Number(brand.quantity || 0),
    price: Number(brand.price || 0),
    costPrice: Number(brand.costPrice || 0),
    barcode: brand.barcode || "",
    expiryDate: brand.expiryDate || null,
    batchNumber: brand.batchNumber || ""
  };
}

function getAllAvailableChoices() {
  const list = [];
  medicines.forEach(medicine => {
    (medicine.brands || []).forEach(brand => {
      if (Number(brand.quantity || 0) > 0) {
        const choice = getChoiceByIds(medicine._id, brand._id);
        if (choice) list.push(choice);
      }
    });
  });
  return list;
}

function storeFormMemory(payload) {
  formMemory = {
    supplier: payload.supplier || formMemory.supplier || "",
    category: payload.category || formMemory.category || ""
  };
  localStorage.setItem("inventoryFormMemory", JSON.stringify(formMemory));
  updateFormMemoryHints();
}

function updateFormMemoryHints() {
  const supplierHint = document.getElementById("lastSupplierHint");
  const categoryHint = document.getElementById("lastCategoryHint");
  if (supplierHint) supplierHint.textContent = `Last supplier: ${formMemory.supplier || "none yet"}`;
  if (categoryHint) categoryHint.textContent = `Last category: ${formMemory.category || "none yet"}`;
}

function applyFormMemoryIfEmpty() {
  const supplierInput = document.getElementById("supplierInput");
  const categoryInput = document.getElementById("categoryInput");
  if (supplierInput && !supplierInput.value && formMemory.supplier) supplierInput.value = formMemory.supplier;
  if (categoryInput && !categoryInput.value && formMemory.category) categoryInput.value = formMemory.category;
}

function setMedicineSaveState(isSaving) {
  const addBtn = document.getElementById("addMedicineBtn");
  const keepOpenBtn = document.getElementById("addMedicineKeepOpenBtn");
  if (addBtn) {
    addBtn.disabled = isSaving;
    addBtn.textContent = isSaving ? "Saving..." : "Add Medicine";
  }
  if (keepOpenBtn) {
    keepOpenBtn.disabled = isSaving;
    keepOpenBtn.textContent = isSaving ? "Saving..." : "Save & Add Another";
  }
}

function setButtonBusy(id, isBusy, busyText, idleText) {
  const button = document.getElementById(id);
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = isBusy ? busyText : idleText;
}

async function loadCurrentUser() {
  const data = await fetchJson("/users/me");
  currentUser = data.user;
  if (!isOwner()) {
    activeStoreId = currentUser.storeId || "";
    localStorage.setItem("activeStoreId", activeStoreId);
  }
  localStorage.setItem("role", currentUser.role);
  document.getElementById("roleLabel").textContent = currentUser.role;
  document.getElementById("activeStoreLabel").textContent = currentUser.storeName || "All Stores";
  document.getElementById("ownerPanel").hidden = !isOwner();
  const staffCreatePanel = document.getElementById("staffCreatePanel");
  const storePanel = document.getElementById("storePanel");
  const transferPanel = document.getElementById("transferPanel");
  const storeSwitcherWrap = document.getElementById("storeSwitcherWrap");
  const addStockQuickAction = document.getElementById("addStockQuickAction");
  if (staffCreatePanel) staffCreatePanel.hidden = !isOwner();
  if (storePanel) storePanel.hidden = !isOwner();
  if (transferPanel) transferPanel.hidden = !isOwner();
  if (storeSwitcherWrap) storeSwitcherWrap.hidden = !isOwner();
  if (addStockQuickAction) addStockQuickAction.hidden = !isOwner();
}

async function loadData() {
  if (isRefreshingData) return;
  try {
    isRefreshingData = true;
    await loadCurrentUser();
    const [storeResult, userResult] = await Promise.allSettled([
      fetchJson("/stores"),
      isOwner() ? fetchJson("/users") : Promise.resolve({ users: currentUser ? [currentUser] : [] })
    ]);
    stores = storeResult.status === "fulfilled" && Array.isArray(storeResult.value?.stores) ? storeResult.value.stores : [];
    teamProfiles = userResult.status === "fulfilled" && Array.isArray(userResult.value?.users) && userResult.value.users.length
      ? userResult.value.users
      : currentUser ? [currentUser] : [];

    // If the selected store no longer exists in the current database, clear it so
    // inventory requests and new stock entries don't keep targeting a dead store id.
    if (isOwner() && activeStoreId && !stores.some(store => String(store._id) === String(activeStoreId))) {
      activeStoreId = "";
      localStorage.removeItem("activeStoreId");
    }

    if (isOwner() && !activeStoreId && stores.length === 1) {
      activeStoreId = String(stores[0]._id);
      localStorage.setItem("activeStoreId", activeStoreId);
    }

    const query = activeStoreId ? `?storeId=${encodeURIComponent(activeStoreId)}` : "";
    const billRequests = isOwner()
      ? [fetchJson(`/bills${query}`), fetchJson("/bills")]
      : [fetchJson(`/bills${query}`)];
    const [medicineData, ...billResults] = await Promise.all([
      fetchJson(`/medicines${query}`),
      ...billRequests
    ]);

    medicines = Array.isArray(medicineData) ? medicineData : [];
    bills = Array.isArray(billResults[0]) ? billResults[0] : [];
    allBills = isOwner()
      ? (Array.isArray(billResults[1]) ? billResults[1] : bills)
      : bills;
    if (isOwner()) {
      const transferData = await fetchJson("/medicines/transfers?limit=20");
      transfers = Array.isArray(transferData.transfers) ? transferData.transfers : [];
    } else {
      transfers = [];
    }

    if (selectedBillingChoice) selectedBillingChoice = getChoiceByIds(selectedBillingChoice.medicineId, selectedBillingChoice.brandId);

    if (storeResult.status === "rejected" || userResult.status === "rejected") {
      const optionalIssues = [];
      if (storeResult.status === "rejected") optionalIssues.push("stores");
      if (userResult.status === "rejected" && isOwner()) optionalIssues.push("team profiles");
      setMessage(`Some optional sections could not load (${optionalIssues.join(", ")}), but inventory and billing are ready.`, "error");
    }

    renderAll();
    if (!hasCompletedInitialRender) {
      hasCompletedInitialRender = true;
      hideBrandLoader();
    }
  } catch (error) {
    document.getElementById("roleLabel").textContent = localStorage.getItem("role") || "Sign in again";
    setMessage(error.message, "error");
    if (!hasCompletedInitialRender) hideBrandLoader(0);
  } finally {
    isRefreshingData = false;
  }
}

function resetFilters() {
  document.getElementById("searchInput").value = "";
  document.getElementById("stockFilter").value = "all";
  renderInventory();
}

function getVisibleMedicines() {
  const q = normalize(document.getElementById("searchInput").value);
  const filter = document.getElementById("stockFilter").value;

  return medicines.filter(medicine => {
    const brands = medicine.brands || [];
    const matchesSearch = !q || [medicine.category, medicine.salt, ...brands.flatMap(brand => [brand.name, brand.brandType, brand.supplier, brand.batchNumber, brand.barcode])]
      .some(value => normalize(value).includes(q));

    const matchesFilter = filter === "all" || brands.some(brand => {
      const level = alertState(brand).level;
      if (filter === "low") return level === "low-stock";
      if (filter === "expired") return level === "expired" || level === "near-expiry";
      if (filter === "healthy") return level === "healthy";
      return true;
    });

    return matchesSearch && matchesFilter;
  });
}

function updateStats() {
  const statsBills = isOwner() ? allBills : bills;
  const brandCount = medicines.reduce((sum, medicine) => sum + (medicine.brands || []).length, 0);
  const alertCount = medicines.reduce((sum, medicine) => sum + (medicine.brands || []).filter(brand => alertState(brand).level !== "healthy").length, 0);
  const revenue = statsBills.reduce((sum, bill) => sum + Number(bill.totalAmount || 0), 0);
  const profit = statsBills.reduce((sum, bill) => sum + Number(bill.totalProfit || 0), 0);
  const lowStockCount = medicines.reduce((sum, medicine) => sum + (medicine.brands || []).filter(brand => alertState(brand).level === "low-stock").length, 0);
  const expirySoonCount = medicines.reduce((sum, medicine) => sum + (medicine.brands || []).filter(brand => {
    const days = daysUntil(brand.expiryDate);
    return days !== null && days >= 0 && days <= EXPIRY_SOON_DAYS;
  }).length, 0);
  const todaysBills = statsBills.filter(bill => isToday(bill.createdAt));
  const todaysRevenue = todaysBills.reduce((sum, bill) => sum + Number(bill.totalAmount || 0), 0);

  document.getElementById("totalMedicineCount").textContent = String(medicines.length);
  document.getElementById("totalBrandCount").textContent = String(brandCount);
  document.getElementById("lowStockCount").textContent = String(alertCount);
  document.getElementById("revenueTotal").textContent = formatAmount(revenue);
  document.getElementById("profitTotal").textContent = formatAmount(profit);
  document.getElementById("restockNowCount").textContent = String(lowStockCount);
  document.getElementById("expirySoonCount").textContent = String(expirySoonCount);
  document.getElementById("billsTodayCount").textContent = String(todaysBills.length);
  document.getElementById("todayRevenueTotal").textContent = formatAmount(todaysRevenue);
}

function renderStoreControls() {
  const switcher = document.getElementById("storeSwitcher");
  const staffStore = document.getElementById("staffStore");
  const storeSwitcherWrap = document.getElementById("storeSwitcherWrap");
  const activeStore = stores.find(store => String(store._id) === String(activeStoreId));
  document.getElementById("activeStoreLabel").textContent = activeStore?.name || currentUser?.storeName || "All Stores";

  const ownerOptions = [`<option value="">All Stores</option>`]
    .concat(stores.map(store => `<option value="${store._id}">${escapeHtml(store.name)}</option>`))
    .join("");
  const workerOptions = stores
    .filter(store => !currentUser?.storeId || String(store._id) === String(currentUser.storeId))
    .map(store => `<option value="${store._id}">${escapeHtml(store.name)}</option>`)
    .join("");

  switcher.innerHTML = isOwner() ? ownerOptions : workerOptions || '<option value="">Assigned Store</option>';
  if (activeStoreId) switcher.value = activeStoreId;
  else if (isOwner()) switcher.value = "";
  switcher.disabled = !isOwner();
  if (storeSwitcherWrap) storeSwitcherWrap.hidden = !isOwner();

  if (staffStore) {
    staffStore.innerHTML = '<option value="">No store assigned</option>' + stores.map(store => `<option value="${store._id}">${escapeHtml(store.name)}</option>`).join("");
  }

  const transferFromStore = document.getElementById("transferFromStore");
  const transferToStore = document.getElementById("transferToStore");
  if (transferFromStore && transferToStore) {
    const options = stores.map(store => `<option value="${store._id}">${escapeHtml(store.name)}</option>`).join("");
    transferFromStore.innerHTML = '<option value="">Select source store</option>' + options;
    transferToStore.innerHTML = '<option value="">Select destination store</option>' + options;
    if (!transferFromStore.value && activeStoreId) transferFromStore.value = activeStoreId;
  }

  const storeList = document.getElementById("storeList");
  if (!storeList) return;
  if (!stores.length) {
    storeList.innerHTML = '<p class="empty">No stores added yet.</p>';
    return;
  }

  storeList.innerHTML = stores.map(store => `
    <div class="supplier-card">
      <strong>${escapeHtml(store.name)}</strong>
      <div class="meta">${escapeHtml(store.code || "No code")} | ${escapeHtml(store.phone || "No phone")} | ${escapeHtml(store.address || "No address")}</div>
    </div>
  `).join("");
}

function getTransferInventoryChoice(medicineId, brandId) {
  const medicine = transferInventory.find(item => item._id === medicineId);
  const brand = medicine?.brands?.find(item => item._id === brandId);
  if (!medicine || !brand) return null;
  return { medicine, brand };
}

async function handleTransferSourceChange() {
  const sourceStoreId = document.getElementById("transferFromStore")?.value || "";
  const medicineSelect = document.getElementById("transferMedicine");
  const brandSelect = document.getElementById("transferBrand");
  const hint = document.getElementById("transferStockHint");

  transferInventory = [];
  if (medicineSelect) medicineSelect.innerHTML = '<option value="">Select medicine</option>';
  if (brandSelect) brandSelect.innerHTML = '<option value="">Select brand</option>';

  if (!sourceStoreId) {
    if (hint) hint.textContent = "Choose a source store to load available stock for transfer.";
    return;
  }

  try {
    const data = await fetchJson(`/medicines?storeId=${encodeURIComponent(sourceStoreId)}`);
    transferInventory = Array.isArray(data) ? data : [];
    if (!transferInventory.length) {
      if (hint) hint.textContent = "No medicines found in the selected source store.";
      return;
    }

    medicineSelect.innerHTML = '<option value="">Select medicine</option>' + transferInventory
      .map(item => `<option value="${item._id}">${escapeHtml(item.salt)} (${escapeHtml(item.category || "General")})</option>`)
      .join("");
    if (hint) hint.textContent = `Loaded ${transferInventory.length} medicines from the selected source store.`;
  } catch (error) {
    if (hint) hint.textContent = error.message;
  }
}

function loadTransferBrands() {
  const medicineId = document.getElementById("transferMedicine")?.value || "";
  const brandSelect = document.getElementById("transferBrand");
  const hint = document.getElementById("transferStockHint");
  const medicine = transferInventory.find(item => item._id === medicineId);

  if (!brandSelect) return;

  if (!medicine) {
    brandSelect.innerHTML = '<option value="">Select brand</option>';
    if (hint) hint.textContent = "Select a medicine to see transferable brands.";
    return;
  }

  const availableBrands = (medicine.brands || []).filter(item => Number(item.quantity || 0) > 0);
  brandSelect.innerHTML = '<option value="">Select brand</option>' + availableBrands
    .map(item => `<option value="${item._id}">${escapeHtml(item.name)} | ${escapeHtml(item.brandType || "Branded")} | ${item.quantity} in stock</option>`)
    .join("");
  if (hint) hint.textContent = availableBrands.length
    ? "Select the brand and quantity to move."
    : "This medicine has no transferable stock in the selected source store.";
}

function renderTransferHistory() {
  const container = document.getElementById("transferHistory");
  if (!container) return;
  if (!transfers.length) {
    container.innerHTML = '<p class="empty">No branch transfers recorded yet.</p>';
    return;
  }

  container.innerHTML = transfers.map(transfer => `
    <div class="supplier-card">
      <strong>${escapeHtml(transfer.medicine?.salt || "Medicine")} - ${escapeHtml(transfer.brand?.name || "Brand")}</strong>
      <div class="meta">${escapeHtml(transfer.fromStore?.storeName || "Source")} to ${escapeHtml(transfer.toStore?.storeName || "Destination")} | Qty ${Number(transfer.quantity || 0)}</div>
      <div class="meta">Batch ${escapeHtml(transfer.brand?.batchNumber || "N/A")} | Supplier ${escapeHtml(transfer.brand?.supplier || "N/A")}</div>
      <div class="meta">Moved by ${escapeHtml(transfer.createdBy?.fullName || transfer.createdBy?.username || "Owner")} on ${formatDateTime(transfer.createdAt)}</div>
      ${transfer.note ? `<div class="meta">Note: ${escapeHtml(transfer.note)}</div>` : ""}
    </div>
  `).join("");
}

async function submitStockTransfer() {
  if (isSubmittingTransfer) return;
  const fromStoreId = document.getElementById("transferFromStore")?.value || "";
  const toStoreId = document.getElementById("transferToStore")?.value || "";
  const medicineId = document.getElementById("transferMedicine")?.value || "";
  const brandId = document.getElementById("transferBrand")?.value || "";
  const quantity = Number(document.getElementById("transferQuantity")?.value || 0);
  const note = document.getElementById("transferNote")?.value.trim() || "";

  if (!fromStoreId || !toStoreId) return setMessage("Select both source and destination stores.", "error");
  if (fromStoreId === toStoreId) return setMessage("Source and destination stores must be different.", "error");
  if (!medicineId || !brandId) return setMessage("Select a medicine and brand to transfer.", "error");
  if (!Number.isInteger(quantity) || quantity <= 0) return setMessage("Enter a valid transfer quantity.", "error");

  const choice = getTransferInventoryChoice(medicineId, brandId);
  if (!choice) return setMessage("Selected stock item was not found.", "error");
  if (quantity > Number(choice.brand.quantity || 0)) return setMessage("Transfer quantity is more than available stock.", "error");

  try {
    isSubmittingTransfer = true;
    setButtonBusy("transferStockBtn", true, "Transferring...", "Transfer Stock");
    const data = await fetchJson("/medicines/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromStoreId, toStoreId, medicineId, brandId, quantity, note })
    });
    document.getElementById("transferQuantity").value = "1";
    document.getElementById("transferNote").value = "";
    setMessage(data.message || "Stock transferred successfully.", "success");
    await loadData();
    await handleTransferSourceChange();
    renderTransferHistory();
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    isSubmittingTransfer = false;
    setButtonBusy("transferStockBtn", false, "Transferring...", "Transfer Stock");
  }
}

function renderInventory() {
  const container = document.getElementById("inventoryList");
  const visible = getVisibleMedicines();
  container.innerHTML = "";
  if (!visible.length) {
    container.innerHTML = '<p class="empty">No medicines match your search or filter.</p>';
    return;
  }

  const groupedByCategory = visible.reduce((acc, medicine) => {
    const category = medicine.category || "General";
    if (!acc[category]) acc[category] = [];
    acc[category].push(medicine);
    return acc;
  }, {});

  Object.entries(groupedByCategory).forEach(([category, categoryMedicines]) => {
    let categoryHtml = `
      <div class="category-card">
        <div class="category-head">
          <div>
            <h3 class="category-title">${escapeHtml(category)}</h3>
            <div class="meta">${categoryMedicines.length} salts in this category</div>
          </div>
        </div>
        <div class="salt-grid">
    `;

    categoryMedicines.forEach(medicine => {
      const brands = medicine.brands || [];
      const groupedBrands = {
        Branded: brands.filter(brand => (brand.brandType || "Branded") === "Branded"),
        Generic: brands.filter(brand => (brand.brandType || "Branded") === "Generic")
      };

      const renderBrandRows = list => list.map(brand => {
        const state = alertState(brand);
        const days = daysUntil(brand.expiryDate);
        const expiryText = brand.expiryDate ? `${formatDate(brand.expiryDate)}${days !== null ? ` (${days < 0 ? `${Math.abs(days)} days ago` : `${days} days left`})` : ""}` : "N/A";
        const badge = state.level === "healthy" ? "good" : state.level === "low-stock" ? "low" : "warn";

        return `
          <div class="brand-row">
            <div>
              <strong>${escapeHtml(brand.name)}</strong>
              <div class="meta">Stock ${brand.quantity} | Sell ${formatAmount(brand.price)} | Cost ${formatAmount(brand.costPrice)}</div>
              <div class="meta">Supplier ${escapeHtml(brand.supplier || "N/A")} | Batch ${escapeHtml(brand.batchNumber || "N/A")} | Expiry ${escapeHtml(expiryText)}</div>
              <div class="meta">Barcode ${escapeHtml(brand.barcode || "N/A")}</div>
            </div>
            <div class="row-actions">
              <span class="tag ${(brand.brandType || "Branded") === "Generic" ? "generic" : "brand"}">${escapeHtml(brand.brandType || "Branded")}</span>
              <span class="tag ${badge}">${escapeHtml(state.text)}</span>
              <button class="btn btn-soft" onclick="selectBillingMedicine('${medicine._id}','${brand._id}', true)">Bill</button>
              ${isOwner() ? `<button class="btn btn-soft" onclick="openEditModal('${medicine._id}','${brand._id}')">Edit</button>` : ""}
              ${isOwner() ? `<button class="btn btn-soft-danger" onclick="deleteBrand('${medicine._id}','${brand._id}','${String(brand.name).replace(/'/g, "\\'")}')">Delete Brand</button>` : ""}
            </div>
          </div>
        `;
      }).join("");

      const brandSections = ["Branded", "Generic"]
        .filter(type => groupedBrands[type].length)
        .map(type => `
          <div class="brand-type-block">
            <div class="brand-type-title">${type}</div>
            <div class="brand-list">${renderBrandRows(groupedBrands[type])}</div>
          </div>
        `).join("");

      categoryHtml += `
        <div class="medicine-card">
          <div class="medicine-top">
            <div>
              <h3>${escapeHtml(medicine.salt)}</h3>
              <div class="meta">${brands.length} entries | Total units ${brands.reduce((sum, brand) => sum + Number(brand.quantity || 0), 0)}</div>
            </div>
            ${isOwner() ? `<button class="btn btn-danger" onclick="deleteMedicine('${medicine._id}','${String(medicine.salt).replace(/'/g, "\\'")}')">Delete Medicine</button>` : ""}
          </div>
          ${brandSections || '<p class="empty">No branded or generic entries.</p>'}
        </div>
      `;
    });

    categoryHtml += `
        </div>
      </div>
    `;

    container.innerHTML += categoryHtml;
  });
}

function renderAlerts() {
  const container = document.getElementById("alertPanel");
  const alerts = [];

  medicines.forEach(medicine => (medicine.brands || []).forEach(brand => {
    const state = alertState(brand);
    if (state.level !== "healthy") {
      alerts.push({
        medicineId: medicine._id,
        brandId: brand._id,
        medicine: medicine.salt,
        brand: brand.name,
        supplier: brand.supplier || "Unassigned supplier",
        state,
        qty: Number(brand.quantity || 0),
        expiry: brand.expiryDate,
        days: daysUntil(brand.expiryDate)
      });
    }
  }));

  alerts.sort((a, b) => {
    const priority = level => level === "expired" ? 0 : level === "near-expiry" ? 1 : 2;
    return priority(a.state.level) - priority(b.state.level) || a.qty - b.qty;
  });

  if (!alerts.length) {
    container.innerHTML = '<p class="empty">No low stock or expiry alerts right now.</p>';
    return;
  }

  container.innerHTML = alerts.map(item => {
    const expiryMeta = item.expiry ? ` | Expiry ${formatDate(item.expiry)}${item.days !== null ? item.days < 0 ? ` (${Math.abs(item.days)} days ago)` : ` (${item.days} days left)` : ""}` : "";
    const alertAction = item.state.level === "low-stock"
      ? `<button class="btn btn-warning" onclick="focusSupplier('${String(item.supplier).replace(/'/g, "\\'")}')">Restock Now</button>`
      : `<button class="btn btn-warning" onclick="filterInventoryForExpiry('${String(item.medicine).replace(/'/g, "\\'")}')">Review Batch</button>`;

    return `
      <div class="alert-card ${item.state.level}">
        <strong>${escapeHtml(item.medicine)} - ${escapeHtml(item.brand)}</strong>
        <div class="meta">${escapeHtml(item.state.text)} | Stock ${item.qty}${escapeHtml(expiryMeta)} | Supplier ${escapeHtml(item.supplier)}</div>
        <div class="actions-row" style="margin-top:12px;">
          ${alertAction}
          <button class="btn btn-soft" onclick="selectBillingMedicine('${item.medicineId}','${item.brandId}', true)">Open In Billing</button>
          ${isOwner() ? `<button class="btn btn-soft" onclick="openEditModal('${item.medicineId}','${item.brandId}')">Edit Stock</button>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

function renderSuppliers() {
  const container = document.getElementById("supplierPanel");
  const map = new Map();

  medicines.forEach(medicine => (medicine.brands || []).forEach(brand => {
    const supplier = brand.supplier || "Unassigned supplier";
    if (!map.has(supplier)) map.set(supplier, { brands: 0, stock: 0, alerts: 0 });
    const entry = map.get(supplier);
    entry.brands += 1;
    entry.stock += Number(brand.quantity || 0);
    if (alertState(brand).level !== "healthy") entry.alerts += 1;
  }));

  if (!map.size) {
    container.innerHTML = '<p class="empty">No supplier data added yet.</p>';
    return;
  }

  container.innerHTML = Array.from(map.entries()).sort((a, b) => b[1].alerts - a[1].alerts).map(([name, info]) => `
    <div class="supplier-card">
      <strong>${escapeHtml(name)}</strong>
      <div class="meta">${info.brands} brands | ${info.stock} units in stock | ${info.alerts} active alerts</div>
      <div class="actions-row" style="margin-top:12px;">
        <button class="btn btn-soft" onclick="filterInventoryBySupplier('${String(name).replace(/'/g, "\\'")}')">View Stock</button>
      </div>
    </div>
  `).join("");
}

function renderTopSelling() {
  const container = document.getElementById("topSellingList");
  const totals = new Map();

  bills.forEach(bill => {
    (bill.items || []).forEach(item => {
      const key = item.name || "Unknown";
      totals.set(key, (totals.get(key) || 0) + Number(item.quantity || 0));
    });
  });

  const ranked = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  if (!ranked.length) {
    container.innerHTML = '<p class="empty">No sales yet for this store.</p>';
    return;
  }

  container.innerHTML = ranked.map(([name, qty], index) => `
    <div class="supplier-card">
      <strong>#${index + 1} ${escapeHtml(name)}</strong>
      <div class="meta">Units sold ${qty}</div>
    </div>
  `).join("");
}

function renderBillHistory() {
  const container = document.getElementById("billHistory");
  const historyBills = isOwner() ? (allBills.length ? allBills : bills) : bills;
  container.innerHTML = "";
  if (!historyBills.length) {
    container.innerHTML = '<p class="empty">No bills created yet.</p>';
    return;
  }

  if (isOwner()) {
    const activeStore = stores.find(store => String(store._id) === String(activeStoreId));
    container.innerHTML = `
      <div class="history-mini">
        <p>Owner bill history shows all branch bills by default.</p>
        <p>All branch bills: ${historyBills.length} | Current store filter: ${activeStore?.name || "All Stores"} | Filtered bills: ${bills.length}</p>
      </div>
    `;
  }

  historyBills.forEach(bill => {
    const items = (bill.items || []).map(item => `
      <div>${escapeHtml(item.name)} x ${item.quantity} = ${formatAmount(item.total)} | Profit ${formatAmount((Number(item.price) - Number(item.costPrice || 0)) * Number(item.quantity || 0))}</div>
    `).join("");

    container.innerHTML += `
      <div class="bill-card">
        <div class="bill-top">
          <div>
            <h4>${escapeHtml(formatInvoiceNumber(bill))}</h4>
            <div class="meta">${formatDateTime(bill.createdAt)}</div>
            <div class="meta">${bill.customer?.phone ? `Customer ${escapeHtml(bill.customer.name || "Walk-in")} | ${escapeHtml(bill.customer.phone)}${bill.customer.isMember ? " | Member" : ""}` : "Walk-in customer"}</div>
            <div class="meta">Handled by ${escapeHtml(bill.createdBy?.fullName || bill.createdBy?.username || "Staff")}</div>
          </div>
          <div style="text-align:right;">
            <strong>${formatAmount(bill.totalAmount)}</strong>
            <div class="meta">Subtotal ${formatAmount(bill.subtotalAmount || bill.totalAmount)} | Discount ${formatAmount(bill.discountAmount || 0)}</div>
            <div class="meta">Profit ${formatAmount(bill.totalProfit)}</div>
          </div>
        </div>
        <div class="bill-items">${items}</div>
        <div class="actions-row" style="margin-top:12px;">
          <button class="btn btn-secondary" onclick="printInvoice('${bill._id}')">Print Invoice</button>
        </div>
      </div>
    `;
  });
}

function renderProfiles() {
  const currentBox = document.getElementById("currentProfileCard");
  const teamBox = document.getElementById("teamProfileList");
  const myProfile = currentUser || null;
  const myMetrics = myProfile?.metrics || {
    patientsThisMonth: 0,
    thresholdPatients: 0,
    extraPatients: 0,
    bonusPerExtraPatient: 0,
    bonusEarned: 0,
    salaryCreditedThisMonth: 0,
    expectedMonthlyPayout: Number(myProfile?.baseSalary || 0),
    attendanceSummary: { present: 0, absent: 0, leave: 0, totalMarkedDays: 0 },
    monthKey: ""
  };

  currentBox.innerHTML = myProfile ? `
    <div class="profile-head">
      <div>
        <h3>${escapeHtml(myProfile.fullName || myProfile.username)}</h3>
        <div class="meta">${escapeHtml(myProfile.jobTitle || (myProfile.role === "owner" ? "Owner" : "Staff"))} | ${escapeHtml(myProfile.phone || "No phone added")}</div>
        <div class="meta">Works at ${escapeHtml(myProfile.storeName || "No store assigned")}</div>
        <div class="meta">This month: ${escapeHtml(myMetrics.monthKey || "Current month")}</div>
      </div>
      <span class="tag ${myProfile.role === "owner" ? "brand" : "generic"}">${escapeHtml(myProfile.role)}</span>
    </div>
    <div class="profile-metrics">
      <div class="metric-box"><span>Patients This Month</span><strong>${myMetrics.patientsThisMonth}</strong></div>
      <div class="metric-box"><span>Threshold</span><strong>${myMetrics.thresholdPatients}</strong></div>
      <div class="metric-box"><span>Bonus Earned</span><strong>${formatAmount(myMetrics.bonusEarned)}</strong></div>
      <div class="metric-box"><span>Salary Credited</span><strong>${formatAmount(myMetrics.salaryCreditedThisMonth)}</strong></div>
    </div>
    <div class="mini-metrics">
      <div class="metric-box"><span>Present</span><strong>${myMetrics.attendanceSummary.present}</strong></div>
      <div class="metric-box"><span>Absent / Leave</span><strong>${myMetrics.attendanceSummary.absent + myMetrics.attendanceSummary.leave}</strong></div>
      <div class="metric-box"><span>Expected Payout</span><strong>${formatAmount(myMetrics.expectedMonthlyPayout)}</strong></div>
    </div>
  ` : '<p class="empty">Profile details are not available.</p>';

  const visibleProfiles = isOwner() ? teamProfiles : [currentUser].filter(Boolean);
  if (!visibleProfiles.length) {
    teamBox.innerHTML = '<p class="empty">No staff accounts found yet.</p>';
    return;
  }

  teamBox.innerHTML = visibleProfiles.map(user => {
    const metrics = user.metrics || myMetrics;
    const latestSalary = (user.salaryCredits || []).slice(-3).reverse();
    return `
      <div class="team-card">
        <div class="profile-head">
          <div>
            <h4>${escapeHtml(user.fullName || user.username)}</h4>
            <div class="meta">${escapeHtml(user.username)} | ${escapeHtml(user.jobTitle || (user.role === "owner" ? "Owner" : "Staff"))}</div>
            <div class="meta">Store ${escapeHtml(user.storeName || "No store assigned")}</div>
            <div class="meta">Base salary ${formatAmount(user.baseSalary)} | Threshold ${metrics.thresholdPatients} | Bonus per extra patient ${formatAmount(metrics.bonusPerExtraPatient)}</div>
          </div>
          <span class="tag ${user.role === "owner" ? "brand" : "generic"}">${escapeHtml(user.role)}</span>
        </div>
        <div class="mini-metrics">
          <div class="metric-box"><span>Patients</span><strong>${metrics.patientsThisMonth}</strong></div>
          <div class="metric-box"><span>Bonus</span><strong>${formatAmount(metrics.bonusEarned)}</strong></div>
          <div class="metric-box"><span>Salary Credited</span><strong>${formatAmount(metrics.salaryCreditedThisMonth)}</strong></div>
        </div>
        <div class="meta">Attendance this month: Present ${metrics.attendanceSummary.present}, Absent ${metrics.attendanceSummary.absent}, Leave ${metrics.attendanceSummary.leave}</div>
        ${isOwner() ? `
          <div class="actions-row">
            <button class="btn btn-soft" onclick="markAttendance('${user.id}','present')">Mark Present</button>
            <button class="btn btn-soft-danger" onclick="markAttendance('${user.id}','absent')">Mark Absent</button>
            <button class="btn btn-secondary" onclick="markAttendance('${user.id}','leave')">Mark Leave</button>
            <button class="btn btn-primary" onclick="creditSalary('${user.id}','${escapeHtml(user.fullName || user.username)}')">Credit Salary</button>
          </div>
        ` : ""}
        <div class="history-mini">
          <p><strong>Recent salary credits</strong></p>
          ${latestSalary.length ? latestSalary.map(entry => `<p>${escapeHtml(entry.monthKey)} | ${formatAmount(entry.amount)}${entry.note ? ` | ${escapeHtml(entry.note)}` : ""}</p>`).join("") : "<p>No salary credits recorded yet.</p>"}
        </div>
      </div>
    `;
  }).join("");
}

function loadDropdowns() {
  const saltSelect = document.getElementById("billSalt");
  const brandSelect = document.getElementById("billBrand");
  const available = medicines.filter(medicine => (medicine.brands || []).some(brand => Number(brand.quantity) > 0));
  const selectedMedicineId = selectedBillingChoice?.medicineId || available[0]?._id || "";

  saltSelect.innerHTML = "";
  brandSelect.innerHTML = "";

  if (!available.length) {
    saltSelect.innerHTML = '<option value="">No medicines available</option>';
    brandSelect.innerHTML = '<option value="">No brands available</option>';
    renderSelectedMedicineCard();
    return;
  }

  available.forEach(medicine => {
    saltSelect.innerHTML += `<option value="${medicine._id}">${escapeHtml(medicine.salt)}</option>`;
  });

  saltSelect.value = selectedMedicineId;
  loadBillBrands(selectedBillingChoice?.brandId);
}

function loadBillBrands(preferredBrandId = "") {
  const medicineId = document.getElementById("billSalt").value;
  const medicine = medicines.find(item => item._id === medicineId);
  const brandSelect = document.getElementById("billBrand");
  brandSelect.innerHTML = "";

  if (!medicine) {
    brandSelect.innerHTML = '<option value="">No brands available</option>';
    selectedBillingChoice = null;
    renderSelectedMedicineCard();
    return;
  }

  const brands = (medicine.brands || []).filter(brand => Number(brand.quantity) > 0);
  if (!brands.length) {
    brandSelect.innerHTML = '<option value="">No brands available</option>';
    selectedBillingChoice = null;
    renderSelectedMedicineCard();
    return;
  }

  brands.forEach(brand => {
    brandSelect.innerHTML += `<option value="${brand._id}">${escapeHtml(brand.name)} - ${escapeHtml(brand.brandType || "Branded")} (${brand.quantity} in stock)</option>`;
  });

  brandSelect.value = brands.some(brand => brand._id === preferredBrandId) ? preferredBrandId : brands[0]._id;
  selectedBillingChoice = getChoiceByIds(medicineId, brandSelect.value);
  renderSelectedMedicineCard();
}

function renderSelectedMedicineCard() {
  const box = document.getElementById("selectedMedicineCard");
  if (!selectedBillingChoice) {
    box.innerHTML = "<strong>No medicine selected.</strong><div class='meta'>Choose a search result, frequent medicine, or barcode match.</div>";
    return;
  }

  const state = alertState({
    quantity: selectedBillingChoice.quantity,
    expiryDate: selectedBillingChoice.expiryDate
  });
  const expiry = selectedBillingChoice.expiryDate ? formatDate(selectedBillingChoice.expiryDate) : "N/A";

  box.innerHTML = `
    <strong>${escapeHtml(selectedBillingChoice.salt)} - ${escapeHtml(selectedBillingChoice.brandName)}</strong>
    <div class="meta">${escapeHtml(selectedBillingChoice.brandType)} | Stock ${selectedBillingChoice.quantity} | Sell ${formatAmount(selectedBillingChoice.price)} | Supplier ${escapeHtml(selectedBillingChoice.supplier)}</div>
    <div class="meta">Batch ${escapeHtml(selectedBillingChoice.batchNumber || "N/A")} | Barcode ${escapeHtml(selectedBillingChoice.barcode || "N/A")} | Expiry ${escapeHtml(expiry)}</div>
    <div class="chip-row" style="margin-top:12px;">
      <span class="tag ${state.level === "healthy" ? "good" : state.level === "low-stock" ? "low" : "warn"}">${escapeHtml(state.text)}</span>
      <span class="tag info">Counter ready</span>
    </div>
  `;
}

function renderBillingFinder() {
  const query = normalize(document.getElementById("billingSearch").value);
  const container = document.getElementById("billingSuggestionBox");
  const ranked = getAllAvailableChoices()
    .filter(item => !query || [item.salt, item.brandName, item.category, item.supplier].some(value => normalize(value).includes(query)))
    .sort((a, b) => {
      const aStarts = normalize(a.salt).startsWith(query) || normalize(a.brandName).startsWith(query);
      const bStarts = normalize(b.salt).startsWith(query) || normalize(b.brandName).startsWith(query);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return a.quantity - b.quantity;
    })
    .slice(0, query ? 6 : 4);

  if (!ranked.length) {
    container.innerHTML = '<p class="empty">No billing matches found.</p>';
    return;
  }

  container.innerHTML = ranked.map(item => `
    <div class="suggestion-card">
      <strong>${escapeHtml(item.salt)} - ${escapeHtml(item.brandName)}</strong>
      <div class="meta">${escapeHtml(item.category)} | ${escapeHtml(item.brandType)} | ${item.quantity} in stock | ${formatAmount(item.price)}</div>
      <div class="meta">Barcode ${escapeHtml(item.barcode || "N/A")} | Supplier ${escapeHtml(item.supplier)}</div>
      <div class="suggestion-actions" style="margin-top:12px;">
        <button class="btn btn-soft" onclick="selectBillingMedicine('${item.medicineId}','${item.brandId}', true)">Select</button>
        <button class="btn btn-primary" onclick="quickAddItem('${item.medicineId}','${item.brandId}', ${quickQuantityValue})">Add ${quickQuantityValue}</button>
      </div>
    </div>
  `).join("");
}

function renderRecentItems() {
  const container = document.getElementById("recentItems");
  if (!recentBillingItems.length) {
    container.innerHTML = '<p class="empty">Recent medicines will appear here after billing.</p>';
    return;
  }

  container.innerHTML = recentBillingItems
    .map(item => getChoiceByIds(item.medicineId, item.brandId))
    .filter(Boolean)
    .slice(0, 6)
    .map(item => `
      <div class="suggestion-card">
        <strong>${escapeHtml(item.salt)} - ${escapeHtml(item.brandName)}</strong>
        <div class="meta">${item.quantity} in stock | ${formatAmount(item.price)} | ${escapeHtml(item.supplier)}</div>
        <div class="suggestion-actions" style="margin-top:12px;">
          <button class="btn btn-soft" onclick="selectBillingMedicine('${item.medicineId}','${item.brandId}', true)">Use</button>
          <button class="btn btn-primary" onclick="quickAddItem('${item.medicineId}','${item.brandId}', ${quickQuantityValue})">Add ${quickQuantityValue}</button>
        </div>
      </div>
    `).join("");
}

function rememberRecentItem(medicineId, brandId) {
  recentBillingItems = [{ medicineId, brandId }, ...recentBillingItems.filter(item => !(item.medicineId === medicineId && item.brandId === brandId))].slice(0, 8);
  localStorage.setItem("recentBillingItems", JSON.stringify(recentBillingItems));
}

function setQuickQuantity(value) {
  quickQuantityValue = value;
  document.getElementById("billQty").value = String(value);
  document.querySelectorAll(".chip-btn").forEach(button => {
    button.classList.toggle("active", Number(button.textContent) === value);
  });
  renderBillingFinder();
  renderRecentItems();
}

function selectBillingMedicine(medicineId, brandId, focusQty = false) {
  selectedBillingChoice = getChoiceByIds(medicineId, brandId);
  if (!selectedBillingChoice) {
    setMessage("Medicine not found.", "error");
    return;
  }

  document.getElementById("billSalt").value = medicineId;
  loadBillBrands(brandId);
  document.getElementById("billingSearch").value = `${selectedBillingChoice.salt} ${selectedBillingChoice.brandName}`;
  document.getElementById("barcodeSearch").value = selectedBillingChoice.barcode || "";
  if (!document.getElementById("billQty").value) document.getElementById("billQty").value = String(quickQuantityValue);
  renderBillingFinder();

  if (focusQty) {
    document.getElementById("billQty").focus();
    document.getElementById("billQty").select();
  }
}

function handleBarcodeSearch(strict = true) {
  const value = normalize(document.getElementById("barcodeSearch").value);
  if (!value) {
    renderBillingFinder();
    return;
  }

  const match = getAllAvailableChoices().find(item => normalize(item.barcode) === value);
  if (match) {
    selectBillingMedicine(match.medicineId, match.brandId, true);
    setMessage("Barcode matched and medicine selected.", "success");
  } else if (strict) {
    setMessage("No medicine found for this barcode.", "error");
  }
}

function quickAddItem(medicineId, brandId, quantity) {
  selectBillingMedicine(medicineId, brandId);
  document.getElementById("billQty").value = String(quantity);
  addToCart();
}

function renderCart() {
  const box = document.getElementById("cartBox");
  const dock = document.getElementById("cartDock");
  document.getElementById("cartCount").textContent = String(cart.length);

  if (!cart.length) {
    box.innerHTML = '<h3 style="margin-top:0;">Cart</h3><p class="empty">Your cart is empty.</p>';
    dock.className = "cart-dock";
    dock.innerHTML = "";
    return;
  }

  const total = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
  const units = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const discountPercent = Number(selectedCustomer?.membershipDiscountPercent || 0);
  const discountAmount = total * (discountPercent / 100);
  const finalTotal = Math.max(0, total - discountAmount);

  box.innerHTML = `
    <h3 style="margin-top:0;">Cart Summary</h3>
    <div class="cart-list">
      ${cart.map((item, index) => `
        <div class="cart-item">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <div class="meta">${item.quantity} x ${formatAmount(item.price)}</div>
          </div>
          <button class="btn btn-soft-danger" onclick="removeItem(${index})">Remove</button>
        </div>
      `).join("")}
    </div>
    <div class="modal-header"><strong>Subtotal</strong><strong>${formatAmount(total)}</strong></div>
    <div class="modal-header"><strong>Discount</strong><strong>${formatAmount(discountAmount)}</strong></div>
    <div class="modal-header"><strong>Total</strong><strong>${formatAmount(finalTotal)}</strong></div>
    <div class="actions-row" style="margin-top:16px;">
      <button class="btn btn-primary" onclick="goToCheckout()">Open Checkout</button>
      <button class="btn btn-secondary" onclick="clearCart()">Clear Cart</button>
    </div>
  `;

  dock.className = "cart-dock show";
  dock.innerHTML = `
    <div class="cart-meta">
      <div class="cart-metric"><span>Items</span><strong>${cart.length}</strong></div>
      <div class="cart-metric"><span>Units</span><strong>${units}</strong></div>
      <div class="cart-metric"><span>Payable</span><strong>${formatAmount(finalTotal)}</strong></div>
    </div>
    <div class="actions-row">
      <button class="btn btn-soft" onclick="toggleCart()">View Cart</button>
      <button class="btn btn-primary" onclick="goToCheckout()">Checkout</button>
    </div>
  `;
}

function toggleCart() {
  const box = document.getElementById("cartBox");
  box.style.display = box.style.display === "block" ? "none" : "block";
}

function addToCart() {
  const medicine = medicines.find(item => item._id === document.getElementById("billSalt").value);
  const quantity = Number(document.getElementById("billQty").value);
  if (!medicine) return setMessage("Select a medicine first.", "error");

  const brand = (medicine.brands || []).find(item => item._id === document.getElementById("billBrand").value);
  if (!brand) return setMessage("Select a brand first.", "error");
  if (!Number.isInteger(quantity) || quantity <= 0) return setMessage("Enter a valid quantity.", "error");

  const existing = cart.find(item => item.medId === medicine._id && item.brandId === brand._id);
  const nextQuantity = quantity + (existing ? existing.quantity : 0);
  if (nextQuantity > Number(brand.quantity)) return setMessage("Requested quantity is more than available stock.", "error");

  if (existing) existing.quantity = nextQuantity;
  else cart.push({
    medId: medicine._id,
    brandId: brand._id,
    name: `${medicine.salt} - ${brand.name}`,
    price: Number(brand.price),
    quantity
  });

  rememberRecentItem(medicine._id, brand._id);
  document.getElementById("billQty").value = String(quickQuantityValue);
  saveCart();
  renderCart();
  renderRecentItems();
  setMessage("Added to cart.", "success");
}

function removeItem(index) {
  cart.splice(index, 1);
  saveCart();
  renderCart();
}

function clearCart() {
  cart = [];
  saveCart();
  renderCart();
  setMessage("Cart cleared.", "success");
}

function updateMembershipUi() {
  const status = document.getElementById("membershipStatus");
  const phoneInput = document.getElementById("customerPhone");
  const nameInput = document.getElementById("customerName");
  const discountInput = document.getElementById("memberDiscount");

  if (!selectedCustomer) {
    status.textContent = "No customer selected. Continue as walk-in or search by phone.";
    phoneInput.value = "";
    nameInput.value = "";
    discountInput.value = "0";
    return;
  }

  phoneInput.value = selectedCustomer.phone || "";
  nameInput.value = selectedCustomer.name || "";
  discountInput.value = String(Number(selectedCustomer.membershipDiscountPercent || 0));
  status.textContent = selectedCustomer.isMember
    ? `Member found: ${selectedCustomer.name || "Customer"} | ${selectedCustomer.phone} | Discount ${selectedCustomer.membershipDiscountPercent || 0}%`
    : `Non-member customer: ${selectedCustomer.phone}`;
}

async function lookupCustomer() {
  if (isLookingUpCustomer) return;
  const phone = String(document.getElementById("customerPhone").value || "").replace(/\D/g, "");
  const name = document.getElementById("customerName").value.trim();

  if (!phone || phone.length < 10) {
    selectedCustomer = null;
    saveCustomer();
    updateMembershipUi();
    renderCart();
    return setMessage("Enter a valid customer phone number.", "error");
  }

  try {
    isLookingUpCustomer = true;
    setButtonBusy("lookupCustomerBtn", true, "Checking...", "Check Membership");
    const data = await fetchJson(`/customers/lookup/${phone}`);
    if (data.customer) {
      selectedCustomer = {
        phone: data.customer.phone,
        name: data.customer.name || name,
        isMember: Boolean(data.customer.isMember),
        membershipDiscountPercent: Number(data.customer.membershipDiscountPercent || 0)
      };
      setMessage(selectedCustomer.isMember ? "Member found. Discount applied." : "Customer found, but not a member.", selectedCustomer.isMember ? "success" : "error");
    } else {
      selectedCustomer = {
        phone,
        name,
        isMember: false,
        membershipDiscountPercent: 0
      };
      setMessage("Customer not found. You can continue as walk-in or save as member.", "error");
    }

    saveCustomer();
    updateMembershipUi();
    renderCart();
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    isLookingUpCustomer = false;
    setButtonBusy("lookupCustomerBtn", false, "Checking...", "Check Membership");
  }
}

async function saveMember() {
  if (isSavingMember) return;
  const phone = String(document.getElementById("customerPhone").value || "").replace(/\D/g, "");
  const name = document.getElementById("customerName").value.trim();
  const membershipDiscountPercent = Number(document.getElementById("memberDiscount").value || 0);

  if (!phone || phone.length < 10) {
    return setMessage("Enter a valid customer phone number.", "error");
  }

  if (!Number.isFinite(membershipDiscountPercent) || membershipDiscountPercent < 0 || membershipDiscountPercent > 100) {
    return setMessage("Discount percent must be between 0 and 100.", "error");
  }

  try {
    isSavingMember = true;
    setButtonBusy("saveMemberBtn", true, "Saving...", "Save As Member");
    const data = await fetchJson("/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        name,
        isMember: true,
        membershipDiscountPercent
      })
    });

    selectedCustomer = {
      phone: data.customer.phone,
      name: data.customer.name,
      isMember: true,
      membershipDiscountPercent: Number(data.customer.membershipDiscountPercent || 0)
    };
    saveCustomer();
    updateMembershipUi();
    renderCart();
    setMessage("Customer saved as member.", "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    isSavingMember = false;
    setButtonBusy("saveMemberBtn", false, "Saving...", "Save As Member");
  }
}

function goToCheckout() {
  if (!cart.length) return setMessage("Cart is empty.", "error");
  localStorage.removeItem("paymentSessionId");
  localStorage.removeItem("paymentMethod");
  localStorage.setItem("pendingCheckoutCart", JSON.stringify(cart));
  localStorage.setItem("pendingCustomer", JSON.stringify(selectedCustomer || {
    phone: String(document.getElementById("customerPhone")?.value || "").replace(/\D/g, ""),
    name: document.getElementById("customerName")?.value?.trim() || "",
    isMember: false,
    membershipDiscountPercent: Number(document.getElementById("memberDiscount")?.value || 0) || 0
  }));
  window.location.href = "checkout.html";
}

function formPayload(prefix) {
  const ids = {
    SaltInput: prefix ? `${prefix}SaltInput` : "saltInput",
    CategoryInput: prefix ? `${prefix}CategoryInput` : "categoryInput",
    BrandInput: prefix ? `${prefix}BrandInput` : "brandInput",
    BrandTypeInput: prefix ? `${prefix}BrandTypeInput` : "brandTypeInput",
    SupplierInput: prefix ? `${prefix}SupplierInput` : "supplierInput",
    PriceInput: prefix ? `${prefix}PriceInput` : "priceInput",
    CostPriceInput: prefix ? `${prefix}CostPriceInput` : "costPriceInput",
    QtyInput: prefix ? `${prefix}QtyInput` : "qtyInput",
    BarcodeInput: prefix ? `${prefix}BarcodeInput` : "barcodeInput",
    BatchInput: prefix ? `${prefix}BatchInput` : "batchInput",
    ExpiryInput: prefix ? `${prefix}ExpiryInput` : "expiryInput"
  };
  const v = id => document.getElementById(ids[id]).value;
  return {
    salt: v("SaltInput").trim(),
    category: v("CategoryInput").trim(),
    name: v("BrandInput").trim(),
    brandType: v("BrandTypeInput"),
    supplier: v("SupplierInput").trim(),
    price: Number(v("PriceInput")),
    costPrice: Number(v("CostPriceInput")),
    quantity: Number(v("QtyInput")),
    barcode: v("BarcodeInput").trim(),
    batchNumber: v("BatchInput").trim(),
    expiryDate: v("ExpiryInput")
  };
}

function clearInventoryForm(keepMemoryDefaults = true) {
  ["categoryInput", "saltInput", "brandInput", "supplierInput", "priceInput", "costPriceInput", "qtyInput", "barcodeInput", "batchInput", "expiryInput"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("brandTypeInput").value = "Branded";
  if (keepMemoryDefaults) applyFormMemoryIfEmpty();
}

async function createStaffAccount() {
  if (isCreatingStaff) return;
  const payload = {
    username: document.getElementById("staffUsername").value.trim(),
    password: document.getElementById("staffPassword").value,
    fullName: document.getElementById("staffFullName").value.trim(),
    phone: document.getElementById("staffPhone").value.trim(),
    jobTitle: document.getElementById("staffJobTitle").value.trim(),
    storeId: document.getElementById("staffStore").value,
    baseSalary: Number(document.getElementById("staffBaseSalary").value || 0),
    monthlyPatientThreshold: Number(document.getElementById("staffThreshold").value || 0),
    bonusPerExtraPatient: Number(document.getElementById("staffBonus").value || 0),
    role: document.getElementById("staffRole").value
  };

  if (!payload.username || !payload.password) {
    return setMessage("Username and password are required for staff accounts.", "error");
  }

  try {
    isCreatingStaff = true;
    setButtonBusy("createStaffBtn", true, "Creating...", "Create Account");
    await fetchJson("/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    ["staffUsername", "staffPassword", "staffFullName", "staffPhone", "staffJobTitle", "staffBaseSalary", "staffThreshold", "staffBonus"].forEach(id => {
      document.getElementById(id).value = "";
    });
    document.getElementById("staffStore").value = "";
    document.getElementById("staffRole").value = "worker";
    setMessage("Staff account created.", "success");
    await loadData();
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    isCreatingStaff = false;
    setButtonBusy("createStaffBtn", false, "Creating...", "Create Account");
  }
}

async function createStore() {
  if (isCreatingStore) return;
  const payload = {
    name: document.getElementById("storeNameInput").value.trim(),
    code: document.getElementById("storeCodeInput").value.trim(),
    phone: document.getElementById("storePhoneInput").value.trim(),
    address: document.getElementById("storeAddressInput").value.trim()
  };

  if (!payload.name) {
    return setMessage("Store name is required.", "error");
  }

  try {
    isCreatingStore = true;
    setButtonBusy("createStoreBtn", true, "Adding...", "Add Store");
    await fetchJson("/stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    ["storeNameInput", "storeCodeInput", "storePhoneInput", "storeAddressInput"].forEach(id => {
      document.getElementById(id).value = "";
    });
    setMessage("Store created successfully.", "success");
    await loadData();
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    isCreatingStore = false;
    setButtonBusy("createStoreBtn", false, "Adding...", "Add Store");
  }
}

function changeActiveStore() {
  if (!isOwner()) return;
  activeStoreId = document.getElementById("storeSwitcher").value;
  localStorage.setItem("activeStoreId", activeStoreId);
  loadData();
}

async function markAttendance(userId, status) {
  try {
    await fetchJson(`/users/${userId}/attendance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, date: new Date().toISOString() })
    });
    setMessage(`Attendance marked as ${status}.`, "success");
    await loadData();
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function creditSalary(userId, label) {
  const amountText = prompt(`Enter salary amount to credit for ${label}`);
  if (amountText === null) return;
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount < 0) {
    return setMessage("Enter a valid salary amount.", "error");
  }

  const note = prompt("Add a note for this salary credit (optional)") || "";

  try {
    await fetchJson(`/users/${userId}/salary-credit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, note })
    });
    setMessage("Salary credited successfully.", "success");
    await loadData();
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function addMedicine(keepOpen = false) {
  if (isSavingMedicine) return;
  const payload = formPayload("");
  if (!payload.salt || !payload.name) return setMessage("Salt and brand name are required.", "error");
  if ([payload.price, payload.costPrice, payload.quantity].some(value => !Number.isFinite(value) || value < 0)) {
    return setMessage("Price, cost, and quantity must be valid non-negative numbers.", "error");
  }
  if (isOwner() && !activeStoreId && stores.length === 1) {
    activeStoreId = String(stores[0]._id);
    localStorage.setItem("activeStoreId", activeStoreId);
  }
  if (isOwner() && stores.length && !activeStoreId) {
    return setMessage("Select a store first so the stock goes into the correct branch inventory.", "error");
  }

  try {
    isSavingMedicine = true;
    setMedicineSaveState(true);
    await fetchJson("/medicines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        category: payload.category || "General",
        salt: payload.salt,
        brand: {
          name: payload.name,
          brandType: payload.brandType || "Branded",
          supplier: payload.supplier,
          price: payload.price,
          costPrice: payload.costPrice,
          quantity: payload.quantity,
          barcode: payload.barcode,
          batchNumber: payload.batchNumber,
          expiryDate: payload.expiryDate || null
        }
        })
      });
    storeFormMemory({ category: payload.category || "General", supplier: payload.supplier });
    clearInventoryForm(keepOpen);
    const storeLabel = stores.find(store => String(store._id) === String(activeStoreId))?.name || "current store";
    setMessage(
      keepOpen
        ? `${payload.name} saved under ${payload.salt} in ${storeLabel}. Form is ready for the next entry.`
        : `${payload.name} saved under ${payload.salt} in ${storeLabel}.`,
      "success"
    );
    await loadData();
    document.getElementById("stockFilter").value = "all";
    document.getElementById("searchInput").value = payload.salt;
    renderInventory();
    if (keepOpen) {
      document.getElementById("saltInput").focus();
      } else {
        document.getElementById("inventoryList").scrollIntoView({ behavior: "smooth", block: "start" });
      }
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    isSavingMedicine = false;
    setMedicineSaveState(false);
  }
}

function openEditModal(medicineId, brandId) {
  const medicine = medicines.find(item => item._id === medicineId);
  const brand = medicine?.brands?.find(item => item._id === brandId);
  if (!medicine || !brand) return setMessage("Medicine not found.", "error");

  editState = { medicineId, brandId };
  document.getElementById("editCategoryInput").value = medicine.category || "";
  document.getElementById("editSaltInput").value = medicine.salt || "";
  document.getElementById("editBrandInput").value = brand.name || "";
  document.getElementById("editBrandTypeInput").value = brand.brandType || "Branded";
  document.getElementById("editSupplierInput").value = brand.supplier || "";
  document.getElementById("editPriceInput").value = brand.price ?? "";
  document.getElementById("editCostPriceInput").value = brand.costPrice ?? "";
  document.getElementById("editQtyInput").value = brand.quantity ?? "";
  document.getElementById("editBarcodeInput").value = brand.barcode || "";
  document.getElementById("editBatchInput").value = brand.batchNumber || "";
  document.getElementById("editExpiryInput").value = brand.expiryDate ? new Date(brand.expiryDate).toISOString().slice(0, 10) : "";
  document.getElementById("editModal").classList.add("show");
}

function closeEditModal() {
  editState = null;
  document.getElementById("editModal").classList.remove("show");
}

async function saveEdit() {
  if (!editState) return;
  const payload = formPayload("edit");
  if (!payload.salt || !payload.name) return setMessage("Salt and brand name are required.", "error");
  if ([payload.price, payload.costPrice, payload.quantity].some(value => !Number.isFinite(value) || value < 0)) {
    return setMessage("Price, cost, and quantity must be valid non-negative numbers.", "error");
  }

  try {
    await fetchJson(`/medicines/${editState.medicineId}/${editState.brandId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    closeEditModal();
    setMessage("Medicine updated successfully.", "success");
    await loadData();
  } catch (error) {
    setMessage(error.message, "error");
  }
}

function applyQuickStock(delta) {
  const input = document.getElementById("editQtyInput");
  const next = Number(input.value || 0) + delta;
  if (next < 0) return setMessage("Stock cannot go below zero.", "error");
  input.value = next;
}

async function deleteBrand(medicineId, brandId, brandName) {
  if (!confirm(`Delete brand "${brandName}"?`)) return;
  try {
    await fetchJson(`/medicines/${medicineId}/${brandId}`, { method: "DELETE" });
    setMessage("Brand deleted.", "success");
    await loadData();
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function deleteMedicine(medicineId, medicineName) {
  if (!confirm(`Delete medicine "${medicineName}" and all its brands?`)) return;
  try {
    await fetchJson(`/medicines/${medicineId}`, { method: "DELETE" });
    cart = cart.filter(item => item.medId !== medicineId);
    saveCart();
    renderCart();
    setMessage("Medicine deleted.", "success");
    await loadData();
  } catch (error) {
    setMessage(error.message, "error");
  }
}

function printInvoice(billId) {
  const localBill = bills.find(item => item._id === billId) || allBills.find(item => item._id === billId);
  if (localBill) {
    openInvoiceWindow(localBill);
    return;
  }

  fetchJson(`/bills/${billId}`)
    .then(data => {
      if (!data.bill) throw new Error("Bill not found.");
      openInvoiceWindow(data.bill);
    })
    .catch(error => {
      setMessage(error.message || "Bill not found.", "error");
    });
}

function openInvoiceWindow(bill) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    setMessage("Popup blocked. Please allow popups to print the invoice.", "error");
    return;
  }
  win.document.write(`
    <html>
      <head>
        <title>Invoice ${formatInvoiceNumber(bill)}</title>
        <style>
          body{font-family:Arial,sans-serif;padding:28px;color:#0f172a}
          .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px}
          .badge{padding:8px 12px;border-radius:999px;background:#ecfeff;color:#155e75;font-weight:700}
          table{width:100%;border-collapse:collapse;margin-top:20px}
          th,td{border-bottom:1px solid #cbd5e1;padding:12px;text-align:left}
          .total{margin-top:20px;display:grid;gap:8px;justify-content:end;font-weight:700}
        </style>
      </head>
      <body>
        <div class="top">
          <div>
            <h1>Lumière de Vie Pharma Invoice</h1>
            <p>Bill Date: ${formatDateTime(bill.createdAt)}</p>
            <p>Invoice No: ${formatInvoiceNumber(bill)}</p>
            <p>Bill ID: ${bill._id}</p>
          </div>
          <div class="badge">Printable Copy</div>
        </div>
        <table>
          <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
          <tbody>
            ${(bill.items || []).map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>${formatAmount(item.price)}</td><td>${formatAmount(item.total)}</td></tr>`).join("")}
          </tbody>
        </table>
        <div class="total">
          <div>Customer: ${bill.customer?.phone ? `${escapeHtml(bill.customer.name || "Customer")} (${escapeHtml(bill.customer.phone)})${bill.customer.isMember ? " - Member" : ""}` : "Walk-in"}</div>
          <div>Subtotal: ${formatAmount(bill.subtotalAmount || bill.totalAmount)}</div>
          <div>Discount: ${formatAmount(bill.discountAmount || 0)}</div>
          <div>Total Revenue: ${formatAmount(bill.totalAmount)}</div>
          <div>Total Profit: ${formatAmount(bill.totalProfit)}</div>
        </div>
        <script>window.onload=()=>window.print();<\/script>
      </body>
    </html>
  `);
  win.document.close();
}

async function logout() {
  try {
    await fetchJson("/users/logout", { method: "POST" });
  } catch (error) {}
  clearInterval(refreshTimer);
  localStorage.clear();
  window.location.replace(`index.html?t=${Date.now()}`);
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!document.hidden && localStorage.getItem("token")) {
      loadData().catch(() => {});
    }
  }, 30000);
}

function filterInventoryBySupplier(supplier) {
  document.getElementById("searchInput").value = supplier === "Unassigned supplier" ? "" : supplier;
  document.getElementById("stockFilter").value = "all";
  renderInventory();
  window.scrollTo({ top: document.getElementById("inventoryList").getBoundingClientRect().top + window.scrollY - 120, behavior: "smooth" });
}

function filterInventoryForExpiry(salt) {
  document.getElementById("searchInput").value = salt;
  document.getElementById("stockFilter").value = "expired";
  renderInventory();
  window.scrollTo({ top: document.getElementById("inventoryList").getBoundingClientRect().top + window.scrollY - 120, behavior: "smooth" });
}

function focusSupplier(supplier) {
  filterInventoryBySupplier(supplier);
}

function focusBillingSearch() {
  document.getElementById("billingSearch").focus();
}

function focusBarcodeSearch() {
  document.getElementById("barcodeSearch").focus();
}

function scrollToOwnerPanel() {
  const panel = document.getElementById("ownerPanel");
  if (!panel || panel.hidden) {
    setMessage("Only the owner can add stock from this account.", "error");
    return;
  }
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("saltInput").focus();
}

function focusAlertPanel() {
  document.getElementById("alertSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

function wireEvents() {
  document.getElementById("billBrand").addEventListener("change", event => {
    selectedBillingChoice = getChoiceByIds(document.getElementById("billSalt").value, event.target.value);
    renderSelectedMedicineCard();
  });

  document.getElementById("billQty").addEventListener("keydown", event => {
    if (event.key === "Enter") addToCart();
  });

  document.getElementById("billingSearch").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      const firstChoice = getAllAvailableChoices().find(item => [item.salt, item.brandName].some(value => normalize(value).includes(normalize(event.target.value))));
      if (firstChoice) selectBillingMedicine(firstChoice.medicineId, firstChoice.brandId, true);
    }
  });

  document.getElementById("barcodeSearch").addEventListener("keydown", event => {
    if (event.key === "Enter") handleBarcodeSearch(true);
  });
}

function renderAll() {
  updateStats();
  renderStoreControls();
  renderInventory();
  renderAlerts();
  renderProfiles();
  renderTopSelling();
  renderSuppliers();
  renderBillHistory();
  renderTransferHistory();
  loadDropdowns();
  updateMembershipUi();
  renderCart();
  renderBillingFinder();
  renderRecentItems();
  renderSelectedMedicineCard();
  updateFormMemoryHints();
  applyFormMemoryIfEmpty();
  if (isOwner() && document.getElementById("transferFromStore")?.value) {
    handleTransferSourceChange().catch(() => {});
  }
}

wireEvents();
setQuickQuantity(1);
loadData();
startAutoRefresh();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && localStorage.getItem("token")) {
    loadData().catch(() => {});
  }
});
