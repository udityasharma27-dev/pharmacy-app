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
let appExperienceMode = localStorage.getItem("appExperienceMode") || "customer";
let customerScannerStream = null;
let customerScannerFrame = null;
let customerScannerActive = false;
let customerScannerStatus = "Use camera scan or enter a barcode to find a product instantly.";
let barcodeDetectorPromise = null;

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
const isCustomerUser = () => currentUser?.role === "customer";
const isCustomerMode = () => appExperienceMode === "customer";

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

function getBarcodeSearchInput() {
  return document.getElementById("barcodeSearch");
}

function getCustomerBarcodeInput() {
  return document.getElementById("customerBarcodeSearch");
}

function setBarcodeSearchValue(value) {
  const nextValue = String(value || "");
  const billingInput = getBarcodeSearchInput();
  const customerInput = getCustomerBarcodeInput();
  if (billingInput) billingInput.value = nextValue;
  if (customerInput) customerInput.value = nextValue;
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

function applyExperienceMode() {
  if (isCustomerUser()) {
    appExperienceMode = "customer";
  }

  document.body.classList.toggle("customer-mode", isCustomerMode());
  document.body.classList.toggle("staff-mode", !isCustomerMode());
  localStorage.setItem("appExperienceMode", appExperienceMode);

  const heroEyebrow = document.getElementById("heroEyebrow");
  const heroTitle = document.querySelector(".hero-copy h1");
  const heroDescription = document.getElementById("heroDescription");
  const billingTitle = document.getElementById("billingTitle");
  const billingSubtitle = document.getElementById("billingSubtitle");
  const loaderText = document.getElementById("brandLoaderText");
  const staffBtn = document.getElementById("staffModeBtn");
  const customerBtn = document.getElementById("customerModeBtn");
  const roleLabel = document.getElementById("roleLabel");

  if (heroEyebrow) heroEyebrow.textContent = isCustomerMode() ? "Customer Storefront" : "Counter Workspace";
  if (heroTitle) heroTitle.textContent = heroTitle.textContent || "Lumiere de Vie Pharma";
  if (heroDescription) {
    heroDescription.textContent = isCustomerMode()
      ? "Turn the counter into a welcoming in-store experience with guided discovery, membership savings, and a fast checkout flow."
      : "Run a premium pharmacy workspace with elegant counter billing, batch-aware stock intelligence, staff performance insight, and a calmer daily flow.";
  }
  if (billingTitle) billingTitle.textContent = isCustomerMode() ? "Customer Checkout Desk" : "Billing Desk";
  if (billingSubtitle) {
    billingSubtitle.textContent = isCustomerMode()
      ? "Search medicines, confirm customer details, and build a polished cart while the shopper is standing at the counter."
      : "Search by medicine, brand, or barcode, then add quickly with quantity shortcuts and recent picks.";
  }
  if (loaderText) {
    loaderText.textContent = isCustomerMode()
      ? "Preparing product discovery, membership savings, and live checkout."
      : "Loading inventory, team insights, and live store controls.";
  }
  if (staffBtn) staffBtn.classList.toggle("active", !isCustomerMode());
  if (customerBtn) customerBtn.classList.toggle("active", isCustomerMode());
  if (staffBtn) staffBtn.hidden = isCustomerUser();
  if (customerBtn) customerBtn.textContent = isCustomerUser() ? "Customer Storefront" : "Customer View";
  if (roleLabel && isCustomerUser()) roleLabel.textContent = "customer";
}

function toggleExperienceMode(mode) {
  appExperienceMode = mode === "staff" ? "staff" : "customer";
  if (!isCustomerMode()) stopCustomerBarcodeScanner();
  applyExperienceMode();
  renderAll();
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
  if (isCustomerUser()) {
    appExperienceMode = "customer";
    localStorage.setItem("appExperienceMode", appExperienceMode);
    selectedCustomer = {
      phone: String(currentUser.phone || "").replace(/\D/g, ""),
      name: currentUser.fullName || "",
      isMember: false,
      membershipDiscountPercent: Number(currentUser.membershipDiscountPercent || 0) || 0
    };
    saveCustomer();
  }
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

function getCustomerTheme(label) {
  const value = normalize(label);
  if (value.includes("skin") || value.includes("beauty")) return { tone: "linear-gradient(135deg, #ffe3ee, #fff7fb)", badge: "SK" };
  if (value.includes("diabetes") || value.includes("bp") || value.includes("heart")) return { tone: "linear-gradient(135deg, #e4f8ff, #f8feff)", badge: "HT" };
  if (value.includes("pain") || value.includes("fever")) return { tone: "linear-gradient(135deg, #fff2db, #fffaf0)", badge: "RF" };
  if (value.includes("digest") || value.includes("stomach")) return { tone: "linear-gradient(135deg, #f4ebff, #fcf8ff)", badge: "DG" };
  return { tone: "linear-gradient(135deg, #e2faf4, #f7fffd)", badge: String(label || "MD").slice(0, 2).toUpperCase() };
}

function renderProductThumb(label, theme) {
  return `<div class="product-thumb" style="background:${theme.tone};"><span>${escapeHtml(theme.badge)}</span></div>`;
}

function syncCustomerSearch(value) {
  const billingSearch = document.getElementById("billingSearch");
  const inventorySearch = document.getElementById("searchInput");
  if (billingSearch) billingSearch.value = value;
  if (inventorySearch) inventorySearch.value = value;
  renderAll();
}

function renderCustomerHeader() {
  const nav = document.getElementById("customerNavBar");
  const storeLabel = document.getElementById("customerHeaderStore");
  const search = document.getElementById("customerSearchBar");
  if (!nav || !storeLabel || !search) return;

  const activeStore = stores.find(store => String(store._id) === String(activeStoreId));
  storeLabel.textContent = activeStore?.name || currentUser?.storeName || "your nearest store";
  if (search.value !== document.getElementById("billingSearch")?.value) {
    search.value = document.getElementById("billingSearch")?.value || "";
  }

  const topCategories = medicines
    .map(item => item.category || "General Wellness")
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 6);

  nav.innerHTML = topCategories.map(category => `
    <button class="customer-nav-link" type="button" onclick="focusCategorySearch('${String(category).replace(/'/g, "\\'")}')">${escapeHtml(category)}</button>
  `).join("");
}

function getCustomerFilteredChoices() {
  const categoryFilter = document.getElementById("customerCategoryFilter")?.value || "all";
  const typeFilter = document.getElementById("customerTypeFilter")?.value || "all";
  const sortValue = document.getElementById("customerPriceSort")?.value || "popular";
  const query = normalize(document.getElementById("billingSearch")?.value || "");

  const filtered = getAllAvailableChoices().filter(item => {
    const matchesQuery = !query || [item.salt, item.brandName, item.category, item.supplier].some(value => normalize(value).includes(query));
    const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
    const matchesType = typeFilter === "all" || item.brandType === typeFilter;
    return matchesQuery && matchesCategory && matchesType;
  });

  filtered.sort((a, b) => {
    if (sortValue === "price-low") return a.price - b.price;
    if (sortValue === "price-high") return b.price - a.price;
    if (sortValue === "stock") return b.quantity - a.quantity;
    return b.quantity - a.quantity || a.price - b.price;
  });

  return filtered;
}

function resetCustomerCatalog() {
  const category = document.getElementById("customerCategoryFilter");
  const type = document.getElementById("customerTypeFilter");
  const sort = document.getElementById("customerPriceSort");
  const billingSearch = document.getElementById("billingSearch");
  const inventorySearch = document.getElementById("searchInput");
  const customerSearch = document.getElementById("customerSearchBar");
  if (category) category.value = "all";
  if (type) type.value = "all";
  if (sort) sort.value = "popular";
  if (billingSearch) billingSearch.value = "";
  if (inventorySearch) inventorySearch.value = "";
  if (customerSearch) customerSearch.value = "";
  renderAll();
}

function renderCustomerBarcodePanel() {
  const panel = document.getElementById("customerBarcodePanel");
  if (!panel) return;

  const barcodeValue = getBarcodeSearchInput()?.value || "";
  const selectedLabel = selectedBillingChoice
    ? `${selectedBillingChoice.salt} - ${selectedBillingChoice.brandName}`
    : "No product selected yet";
  const cameraReady = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && "BarcodeDetector" in window;

  panel.innerHTML = `
    <div class="customer-barcode-head">
      <div>
        <p class="customer-barcode-kicker">Barcode Help</p>
        <h3>Scan at the customer side</h3>
        <p>Use the camera on supported browsers or type the barcode manually if the scanner device sends keyboard input.</p>
      </div>
      <div class="product-pill-row">
        <span class="product-pill">${cameraReady ? "Camera ready" : "Manual entry mode"}</span>
        <span class="product-pill">${barcodeValue ? `Barcode ${escapeHtml(barcodeValue)}` : "Waiting for barcode"}</span>
      </div>
    </div>
    <div class="customer-barcode-grid">
      <div class="customer-barcode-card">
        <label for="customerBarcodeSearch">Barcode</label>
        <div class="customer-barcode-entry">
          <input id="customerBarcodeSearch" placeholder="Scan or type barcode" value="${escapeHtml(barcodeValue)}" oninput="syncCustomerBarcode(this.value)" onkeydown="if(event.key==='Enter') handleBarcodeSearch(true)">
          <button class="btn btn-primary" type="button" onclick="handleBarcodeSearch(true)">Find Product</button>
        </div>
        <div class="customer-barcode-actions">
          <button class="btn btn-soft" type="button" onclick="focusBarcodeSearch()">Focus Barcode</button>
          <button class="btn btn-soft" type="button" onclick="${customerScannerActive ? "stopCustomerBarcodeScanner('Camera scanner closed.')" : "startCustomerBarcodeScanner()"}">${customerScannerActive ? "Stop Camera" : "Open Camera Scanner"}</button>
          <button class="btn btn-secondary" type="button" onclick="clearCustomerBarcodeSearch()">Clear</button>
        </div>
        <div class="customer-barcode-note">${cameraReady ? "Best on HTTPS or localhost with the rear camera." : "Camera scan needs a secure browser that supports BarcodeDetector. Manual barcode search still works."}</div>
      </div>
      <div class="customer-barcode-card">
        <strong>Matched product</strong>
        <div class="meta">${escapeHtml(selectedLabel)}</div>
        <div class="customer-barcode-note">${escapeHtml(customerScannerStatus)}</div>
        ${customerScannerActive ? `
          <div class="customer-scanner-shell">
            <video id="customerBarcodeVideo" autoplay muted playsinline></video>
          </div>
        ` : `
          <div class="customer-scan-placeholder">
            <strong>${cameraReady ? "Camera idle" : "Manual barcode search"}</strong>
            <span>${cameraReady ? "Open the scanner and point it at the product barcode." : "Use a scanner gun or type the barcode here to select the medicine."}</span>
          </div>
        `}
      </div>
    </div>
  `;

  if (customerScannerActive) attachCustomerScannerVideo();
}

async function getBarcodeDetector() {
  if (!("BarcodeDetector" in window)) return null;
  if (!barcodeDetectorPromise) {
    barcodeDetectorPromise = (async () => {
      try {
        const supportedFormats = await window.BarcodeDetector.getSupportedFormats();
        const preferredFormats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "codabar", "itf"];
        const formats = preferredFormats.filter(format => supportedFormats.includes(format));
        return new window.BarcodeDetector(formats.length ? { formats } : undefined);
      } catch (error) {
        return new window.BarcodeDetector();
      }
    })();
  }
  return barcodeDetectorPromise;
}

function attachCustomerScannerVideo() {
  const video = document.getElementById("customerBarcodeVideo");
  if (!video || !customerScannerStream) return;
  if (video.srcObject !== customerScannerStream) video.srcObject = customerScannerStream;
  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {});
  }
}

function syncCustomerBarcode(value) {
  setBarcodeSearchValue(value);
  renderCustomerBarcodePanel();
}

function clearCustomerBarcodeSearch() {
  setBarcodeSearchValue("");
  customerScannerStatus = "Barcode cleared. Scan again or type a new barcode.";
  renderBillingFinder();
  renderCustomerBarcodePanel();
}

function stopCustomerBarcodeScanner(statusText = "") {
  customerScannerActive = false;
  if (customerScannerFrame) {
    window.cancelAnimationFrame(customerScannerFrame);
    customerScannerFrame = null;
  }
  if (customerScannerStream) {
    customerScannerStream.getTracks().forEach(track => track.stop());
    customerScannerStream = null;
  }
  if (statusText) customerScannerStatus = statusText;
  renderCustomerBarcodePanel();
}

async function scanCustomerBarcode(detector) {
  if (!customerScannerActive) return;
  const video = document.getElementById("customerBarcodeVideo");

  if (video && video.readyState >= 2) {
    try {
      const results = await detector.detect(video);
      const rawValue = results?.[0]?.rawValue ? String(results[0].rawValue).trim() : "";
      if (rawValue) {
        customerScannerStatus = `Scanned ${rawValue}. Looking up product now.`;
        setBarcodeSearchValue(rawValue);
        handleBarcodeSearch(true);
        stopCustomerBarcodeScanner("Barcode scanned successfully.");
        return;
      }
    } catch (error) {}
  }

  customerScannerFrame = window.requestAnimationFrame(() => scanCustomerBarcode(detector));
}

async function startCustomerBarcodeScanner() {
  if (customerScannerActive) return;

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    customerScannerStatus = "Camera scan needs HTTPS or localhost access in a supported browser.";
    renderCustomerBarcodePanel();
    setMessage(customerScannerStatus, "error");
    return;
  }

  const detector = await getBarcodeDetector();
  if (!detector) {
    customerScannerStatus = "This browser does not support built-in barcode detection yet.";
    renderCustomerBarcodePanel();
    setMessage(customerScannerStatus, "error");
    return;
  }

  try {
    customerScannerStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    customerScannerActive = true;
    customerScannerStatus = "Camera opened. Hold the barcode inside the frame.";
    renderCustomerBarcodePanel();
    attachCustomerScannerVideo();
    scanCustomerBarcode(detector);
  } catch (error) {
    customerScannerStatus = error?.name === "NotAllowedError"
      ? "Camera permission was denied. Allow access and try again."
      : "Unable to open the camera scanner on this device.";
    renderCustomerBarcodePanel();
    setMessage(customerScannerStatus, "error");
  }
}

function renderCustomerExperience() {
  const benefitsBox = document.getElementById("customerBenefits");
  const serviceBox = document.getElementById("customerServiceCards");
  const categoryBox = document.getElementById("customerCategoryChips");
  const shelfBox = document.getElementById("customerShelf");
  const inventoryBox = document.getElementById("customerInventoryList");
  const catalogHeader = document.getElementById("customerCatalogHeader");
  const faqBox = document.getElementById("customerFaq");
  const categoryFilter = document.getElementById("customerCategoryFilter");
  const filterTags = document.getElementById("customerFilterTags");
  const assistedPanel = document.getElementById("assistedWorkspacePanel");
  const barcodePanel = document.getElementById("customerBarcodePanel");

  if (!benefitsBox || !serviceBox || !categoryBox || !shelfBox || !inventoryBox || !catalogHeader || !faqBox || !categoryFilter || !filterTags || !assistedPanel || !barcodePanel) return;

  const choices = getAllAvailableChoices();
  const categoryMap = medicines.reduce((acc, medicine) => {
    const category = medicine.category || "General Wellness";
    if (!acc.has(category)) acc.set(category, { salts: 0, brands: 0 });
    const entry = acc.get(category);
    entry.salts += 1;
    entry.brands += (medicine.brands || []).filter(brand => Number(brand.quantity || 0) > 0).length;
    return acc;
  }, new Map());

  const topCategories = Array.from(categoryMap.entries())
    .sort((a, b) => b[1].brands - a[1].brands)
    .slice(0, 4);

  const popularItems = Array.from(new Map(
    choices
      .slice()
      .sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0))
      .slice(0, 6)
      .map(item => [`${item.medicineId}:${item.brandId}`, item])
  ).values());

  const availableBrands = choices.length;
  const activeStore = stores.find(store => String(store._id) === String(activeStoreId));
  const savingsText = selectedCustomer?.isMember
    ? `${selectedCustomer.membershipDiscountPercent || 0}% member savings ready`
    : "Membership savings available at the counter";

  renderCustomerHeader();

  const categoryOptions = ['<option value="all">All categories</option>']
    .concat(Array.from(categoryMap.keys()).sort((a, b) => a.localeCompare(b)).map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`))
    .join("");
  if (categoryFilter.innerHTML !== categoryOptions) categoryFilter.innerHTML = categoryOptions;

  const filteredChoices = getCustomerFilteredChoices();
  const activeCategory = document.getElementById("customerCategoryFilter")?.value || "all";
  const activeType = document.getElementById("customerTypeFilter")?.value || "all";
  const activeSort = document.getElementById("customerPriceSort")?.value || "popular";
  const query = document.getElementById("billingSearch")?.value?.trim() || "";
  const headingLabel = activeCategory !== "all" ? activeCategory : query ? query : "Health concerns";
  const querySentence = query
    ? `Showing customer-ready products that match "${escapeHtml(query)}".`
    : "Browse medicines by category, compare trusted brands, and help shoppers choose the right option faster.";

  catalogHeader.innerHTML = `
    <div class="customer-breadcrumbs"><span>Home</span> &rsaquo; Medicines &rsaquo; ${escapeHtml(headingLabel)}</div>
    <h2>${escapeHtml(headingLabel)} Medicines</h2>
    <p>${querySentence}</p>
  `;

  filterTags.innerHTML = [
    activeCategory !== "all" ? activeCategory : "All categories",
    activeType !== "all" ? activeType : "All products",
    activeSort === "popular" ? "Popular first" : activeSort === "price-low" ? "Lowest price first" : activeSort === "price-high" ? "Highest price first" : "Highest stock first"
  ].map(tag => `<span class="customer-filter-tag">${escapeHtml(tag)}</span>`).join("");

  assistedPanel.innerHTML = `
    <div class="assisted-workspace-head">
      <div>
        <h3>Assisted Workspace</h3>
        <p>Customer sees a clean storefront while the pharmacist still gets fast operational context for the same interaction.</p>
      </div>
      <div class="product-pill-row">
        <span class="product-pill">Source: in-store</span>
        <span class="product-pill">Context: staff controlled</span>
      </div>
    </div>
    <div class="assisted-workspace-grid">
      <div class="assisted-card">
        <strong>Customer lookup</strong>
        <div class="meta">${selectedCustomer?.phone ? `${escapeHtml(selectedCustomer.name || "Customer")} | ${escapeHtml(selectedCustomer.phone)}` : "No customer linked yet"}</div>
      </div>
      <div class="assisted-card">
        <strong>Current cart</strong>
        <div class="meta">${cart.length} items | ${cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} units</div>
      </div>
      <div class="assisted-card">
        <strong>Store status</strong>
        <div class="meta">${escapeHtml(activeStore?.name || currentUser?.storeName || "Main store")} | ${filteredChoices.length} matching products</div>
      </div>
    </div>
  `;

  renderCustomerBarcodePanel();

  benefitsBox.innerHTML = [
    {
      label: "Available today",
      value: `${availableBrands}+`,
      detail: "medicine options ready to discover and bill right now"
    },
    {
      label: "Fast help",
      value: "Counter guided",
      detail: "a pharmacist or staff member can help compare options instantly"
    },
    {
      label: "Member savings",
      value: selectedCustomer?.isMember ? "Savings active" : "Ask today",
      detail: savingsText
    }
  ].map(item => `
    <div class="customer-benefit-card">
      <p>${escapeHtml(item.label)}</p>
      <strong>${escapeHtml(item.value)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </div>
  `).join("");

  serviceBox.innerHTML = [
    {
      tone: "primary",
      title: "Order from prescription",
      body: "Upload or read out the prescription at the counter and let the staff quickly search the right medicines for you."
    },
    {
      tone: "secondary",
      title: "No prescription?",
      body: "Browse by health concern, compare options, and ask staff to guide you toward suitable OTC products."
    },
    {
      tone: "accent",
      title: "Membership & repeat orders",
      body: `Save time on repeat purchases with phone-based lookup at ${activeStore?.name || "this store"} and faster checkout for regular customers.`
    }
  ].map(item => `
    <div class="customer-service-card ${item.tone}">
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.body)}</p>
    </div>
  `).join("");

  categoryBox.innerHTML = topCategories.length
    ? topCategories.map(([category, info]) => `
      <button class="customer-category-chip" type="button" onclick="focusCategorySearch('${String(category).replace(/'/g, "\\'")}')">
        ${renderProductThumb(category, getCustomerTheme(category))}
        <strong>${escapeHtml(category)}</strong>
        <div class="meta">${info.salts} salts | ${info.brands} available brands</div>
      </button>
    `).join("")
    : '<p class="empty">Add medicines to highlight customer-ready categories.</p>';

  shelfBox.innerHTML = popularItems.length
    ? popularItems.map(item => `
      <div class="customer-shelf-card">
        ${renderProductThumb(item.brandName, getCustomerTheme(item.category))}
        <strong>${escapeHtml(item.salt)} - ${escapeHtml(item.brandName)}</strong>
        <div class="meta">${escapeHtml(item.category)} | ${escapeHtml(item.brandType)} | ${formatAmount(item.price)}</div>
        <div class="product-pill-row">
          <span class="product-pill">${item.quantity} in stock</span>
          <span class="product-pill">${escapeHtml(item.brandType)}</span>
        </div>
        <div class="actions-row" style="margin-top:12px;">
          <button class="btn btn-soft" type="button" onclick="selectBillingMedicine('${item.medicineId}','${item.brandId}', true)">View</button>
          <button class="btn btn-primary" type="button" onclick="quickAddItem('${item.medicineId}','${item.brandId}', ${quickQuantityValue})">Add ${quickQuantityValue}</button>
        </div>
      </div>
    `).join("")
    : '<p class="empty">No customer-ready products are available yet.</p>';

  inventoryBox.innerHTML = filteredChoices.length
    ? `
      <div class="customer-results-head">
        <strong>Showing ${filteredChoices.length} products for ${escapeHtml(headingLabel)}</strong>
        <div class="customer-sort-pill">Sort by: ${escapeHtml(activeSort === "popular" ? "Popularity" : activeSort === "price-low" ? "Price Low to High" : activeSort === "price-high" ? "Price High to Low" : "Stock availability")}</div>
      </div>
      <div class="customer-result-grid">${filteredChoices.slice(0, 12).map(item => {
        const theme = getCustomerTheme(item.category || item.salt);
        const oldPrice = item.price * 1.18;
        const discount = Math.max(5, Math.round(((oldPrice - item.price) / oldPrice) * 100));
        return `
          <div class="customer-product-card">
            ${renderProductThumb(item.brandName, theme)}
            <h3>${escapeHtml(item.brandName)}</h3>
            <div class="customer-product-meta">${escapeHtml(item.salt)} | ${escapeHtml(item.category)}</div>
            <div class="customer-product-meta">${escapeHtml(item.supplier || "Trusted supplier")} | ${item.quantity} in stock</div>
            <div class="customer-price-line">
              <strong>${formatAmount(item.price)}</strong>
              <span>${discount}% OFF</span>
            </div>
            <div class="customer-product-meta"><s>${formatAmount(oldPrice)}</s> | ${escapeHtml(item.brandType)}</div>
            <div class="customer-delivery-note">Available today at ${escapeHtml(activeStore?.name || currentUser?.storeName || "your store")}</div>
            <div class="product-pill-row">
              <span class="product-pill">${escapeHtml(item.brandType)}</span>
              <span class="product-pill">${escapeHtml(item.category)}</span>
            </div>
            <div class="actions-row" style="margin-top:12px;">
              <button class="btn btn-soft" type="button" onclick="selectBillingMedicine('${item.medicineId}','${item.brandId}', true)">View</button>
              <button class="btn btn-primary" type="button" onclick="quickAddItem('${item.medicineId}','${item.brandId}', ${quickQuantityValue})">Add</button>
            </div>
          </div>
        `;
      }).join("")}</div>
    `
    : '<p class="empty">No medicines match the current filters. Try another category or clear the search.</p>';

  faqBox.innerHTML = `
    <h3>Frequently Asked Questions</h3>
    <div class="customer-faq-item">
      <strong>Can I switch from a branded medicine to a generic?</strong>
      <p>Generics may contain the same active ingredient, but it is best to confirm the right option with the pharmacist before billing.</p>
    </div>
    <div class="customer-faq-item">
      <strong>How do I choose the right dosage?</strong>
      <p>Dosage depends on age, symptoms, and existing prescriptions. Ask the pharmacist before adding it to the cart if you are unsure.</p>
    </div>
    <div class="customer-faq-item">
      <strong>Do I need a prescription?</strong>
      <p>Prescription medicines should only be billed when a valid prescription is available. OTC products can be selected directly from the storefront.</p>
    </div>
  `;
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
  const isCustomerFacing = isCustomerMode();

  box.innerHTML = `
    <strong>${escapeHtml(selectedBillingChoice.salt)} - ${escapeHtml(selectedBillingChoice.brandName)}</strong>
    <div class="meta">${escapeHtml(selectedBillingChoice.brandType)} | ${formatAmount(selectedBillingChoice.price)} | ${isCustomerFacing ? `${selectedBillingChoice.quantity} ready now` : `Stock ${selectedBillingChoice.quantity}`}</div>
    <div class="meta">${isCustomerFacing ? `Category ${escapeHtml(selectedBillingChoice.category)} | Barcode ${escapeHtml(selectedBillingChoice.barcode || "N/A")} | Expiry ${escapeHtml(expiry)}` : `Batch ${escapeHtml(selectedBillingChoice.batchNumber || "N/A")} | Barcode ${escapeHtml(selectedBillingChoice.barcode || "N/A")} | Expiry ${escapeHtml(expiry)}`}</div>
    <div class="chip-row" style="margin-top:12px;">
      <span class="tag ${state.level === "healthy" ? "good" : state.level === "low-stock" ? "low" : "warn"}">${escapeHtml(state.text)}</span>
      <span class="tag info">${isCustomerFacing ? "Ready for cart" : "Counter ready"}</span>
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
      <div class="meta">${isCustomerMode() ? `Ready for quick billing | Barcode ${escapeHtml(item.barcode || "N/A")}` : `Barcode ${escapeHtml(item.barcode || "N/A")} | Supplier ${escapeHtml(item.supplier)}`}</div>
      <div class="suggestion-actions" style="margin-top:12px;">
        <button class="btn btn-soft" onclick="selectBillingMedicine('${item.medicineId}','${item.brandId}', true)">${isCustomerMode() ? "View" : "Select"}</button>
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
  setBarcodeSearchValue(selectedBillingChoice.barcode || "");
  if (!document.getElementById("billQty").value) document.getElementById("billQty").value = String(quickQuantityValue);
  renderBillingFinder();
  renderCustomerBarcodePanel();

  if (focusQty) {
    document.getElementById("billQty").focus();
    document.getElementById("billQty").select();
  }
}

function handleBarcodeSearch(strict = true) {
  const value = normalize(getBarcodeSearchInput()?.value);
  renderCustomerBarcodePanel();
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
  const customerCartCount = document.getElementById("customerCartCount");
  if (customerCartCount) customerCartCount.textContent = String(cart.length);
  const cartTitle = isCustomerMode() ? "Shopping Summary" : "Cart Summary";
  const checkoutLabel = isCustomerMode() ? "Continue To Checkout" : "Open Checkout";

  if (!cart.length) {
    box.innerHTML = `<h3 style="margin-top:0;">${cartTitle}</h3><p class="empty">${isCustomerMode() ? "No medicines added yet. Search or browse to start building the order." : "Your cart is empty."}</p>`;
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
    <h3 style="margin-top:0;">${cartTitle}</h3>
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
    <div class="modal-header"><strong>${isCustomerMode() ? "Savings" : "Discount"}</strong><strong>${formatAmount(discountAmount)}</strong></div>
    <div class="modal-header"><strong>Total</strong><strong>${formatAmount(finalTotal)}</strong></div>
    <div class="actions-row" style="margin-top:16px;">
      <button class="btn btn-primary" onclick="goToCheckout()">${checkoutLabel}</button>
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
      <button class="btn btn-primary" onclick="goToCheckout()">${isCustomerMode() ? "Checkout" : "Open Checkout"}</button>
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
    status.textContent = isCustomerMode()
      ? "Add a phone number to check membership savings, or continue as a walk-in shopper."
      : "No customer selected. Continue as walk-in or search by phone.";
    phoneInput.value = "";
    nameInput.value = "";
    discountInput.value = "0";
    return;
  }

  phoneInput.value = selectedCustomer.phone || "";
  nameInput.value = selectedCustomer.name || "";
  discountInput.value = String(Number(selectedCustomer.membershipDiscountPercent || 0));
  status.textContent = selectedCustomer.isMember
    ? `${selectedCustomer.name || "Customer"} is a member | ${selectedCustomer.phone} | Savings ${selectedCustomer.membershipDiscountPercent || 0}%`
    : isCustomerMode()
      ? `Customer found at ${selectedCustomer.phone} | not enrolled in membership yet`
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
  const activeStore = stores.find(store => String(store._id) === String(activeStoreId));
  const checkoutCustomer = selectedCustomer || {
    phone: String(document.getElementById("customerPhone")?.value || currentUser?.phone || "").replace(/\D/g, ""),
    name: document.getElementById("customerName")?.value?.trim() || currentUser?.fullName || "",
    isMember: Boolean(isCustomerUser()),
    membershipDiscountPercent: Number(document.getElementById("memberDiscount")?.value || 0) || 0
  };
  localStorage.removeItem("paymentSessionId");
  localStorage.removeItem("paymentMethod");
  localStorage.setItem("pendingOrderSource", isCustomerUser() ? "online" : "in_store");
  localStorage.setItem("pendingCustomerContext", isCustomerUser() ? "self_service" : "staff_controlled");
  localStorage.setItem("pendingCheckoutCart", JSON.stringify(cart));
  localStorage.setItem("pendingCustomer", JSON.stringify(checkoutCustomer));
  localStorage.setItem("pendingStore", JSON.stringify({
    storeId: activeStore?._id || activeStoreId || currentUser?.storeId || "",
    storeName: activeStore?.name || currentUser?.storeName || document.getElementById("activeStoreLabel")?.textContent || ""
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
  stopCustomerBarcodeScanner();
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

function focusCustomerSearch() {
  if (!isCustomerMode()) {
    appExperienceMode = "customer";
    applyExperienceMode();
  }
  document.getElementById("billingSearch").scrollIntoView({ behavior: "smooth", block: "center" });
  document.getElementById("billingSearch").focus();
}

function focusCustomerMembership() {
  if (!isCustomerMode()) {
    appExperienceMode = "customer";
    applyExperienceMode();
  }
  document.getElementById("customerPhone").scrollIntoView({ behavior: "smooth", block: "center" });
  document.getElementById("customerPhone").focus();
}

function focusCategorySearch(category) {
  document.getElementById("billingSearch").value = category;
  document.getElementById("searchInput").value = category;
  const customerSearch = document.getElementById("customerSearchBar");
  if (customerSearch) customerSearch.value = category;
  renderAll();
  focusCustomerSearch();
}

function focusBarcodeSearch() {
  if (isCustomerMode()) {
    document.getElementById("customerBarcodePanel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    const customerInput = getCustomerBarcodeInput();
    if (customerInput) {
      customerInput.focus();
      customerInput.select();
      return;
    }
  }
  const billingInput = getBarcodeSearchInput();
  if (billingInput) {
    billingInput.focus();
    billingInput.select();
  }
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

  document.getElementById("billingSearch").addEventListener("input", event => {
    const value = event.target.value;
    const customerSearch = document.getElementById("customerSearchBar");
    const inventorySearch = document.getElementById("searchInput");
    if (customerSearch && customerSearch.value !== value) customerSearch.value = value;
    if (inventorySearch && inventorySearch.value !== value) inventorySearch.value = value;
    if (isCustomerMode()) renderCustomerExperience();
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
  applyExperienceMode();
  updateStats();
  renderStoreControls();
  renderInventory();
  renderCustomerExperience();
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
applyExperienceMode();
setQuickQuantity(1);
loadData();
startAutoRefresh();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && localStorage.getItem("token")) {
    loadData().catch(() => {});
  }
});
