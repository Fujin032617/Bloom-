// =====================================================================
// SHOP.HTML — customer home page logic
// Requires firebase-config.js to be loaded first.
// =====================================================================

document.getElementById('year').textContent = new Date().getFullYear();

// ============================================================
// STATE
// ============================================================
let allProducts = [];
let cart = {}; // { productId: qty }
let cartStorageKey = null; // set once we know the signed-in user's uid, e.g. "bloome_cart_<uid>"
let activeCategory = 'top';
let sortBy = 'newest';
let searchTerm = '';
let siteSettings = {};
let selectedPayMethod = null;
let userCreditBalance = 0; // this customer's referral store credit, kept live
let customerProfile = {}; // { name, phone, address } from users/{uid}, used to pre-fill checkout

// ============================================================
// CART PERSISTENCE (localStorage)
// The bag is kept per signed-in user (keyed by uid) so it survives
// refreshes, closed tabs, and accidental navigation, but doesn't leak
// between different accounts on a shared browser.
// ============================================================
function loadCart(uid){
  try{
    const raw = localStorage.getItem(`bloome_cart_${uid}`);
    const parsed = raw ? JSON.parse(raw) : {};
    return (parsed && typeof parsed === 'object') ? parsed : {};
  }catch(err){
    console.error('Could not read saved cart', err);
    return {};
  }
}
function saveCart(){
  if(!cartStorageKey) return;
  try{
    localStorage.setItem(cartStorageKey, JSON.stringify(cart));
  }catch(err){
    console.error('Could not save cart', err);
  }
}
// Drops any cart entries for products that no longer exist or have gone
// out of stock since the cart was last saved (e.g. the user left the
// tab open for a while, or came back on another day).
function pruneCartAgainstStock(){
  let changed = false;
  Object.keys(cart).forEach(id=>{
    const p = allProducts.find(x=>x.id===id);
    const stock = p ? availableStock(p, allProducts) : 0;
    if(!p || stock <= 0){
      delete cart[id];
      changed = true;
    } else if(cart[id] > stock){
      cart[id] = stock;
      changed = true;
    }
  });
  if(changed) saveCart();
}

// ============================================================
// AUTH GATE — only signed-in users (customer or admin) get in.
// Admins are still allowed to browse the shop like anyone else.
// ============================================================
requireRole(['customer','admin'], (user, role)=>{
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('shopRoot').style.display = 'block';

  const label = user.email ? user.email.split('@')[0] : 'there';
  document.getElementById('accountLabel').textContent = `Hi, ${label}`;
  document.getElementById('accountAvatar').textContent = (user.email||'?').charAt(0).toUpperCase();

  cartStorageKey = `bloome_cart_${user.uid}`;
  cart = loadCart(user.uid);
  renderCart();

  listenProducts();
  loadSiteSettings();
  listenUserCredit(user.uid);
  loadCustomerProfile(user.uid);

  // One-time check (not live) so a customer finds out an order moved
  // forward — e.g. "Shipped" — even if they never open account.html.
  db.collection('orders').where('customerUid','==',user.uid).get()
    .then(snap=>{
      const orders = [];
      snap.forEach(doc=> orders.push({id:doc.id, ...doc.data()}));
      notifyOrderStatusChanges(orders, user.uid);
    })
    .catch(err=>console.error('Could not check order status updates', err));
});

// Loads this customer's saved name/phone/address so the checkout modal
// can pre-fill itself instead of making them retype it every order.
async function loadCustomerProfile(uid){
  try{
    const doc = await db.collection('users').doc(uid).get();
    customerProfile = doc.exists ? (doc.data() || {}) : {};
  }catch(err){
    console.error('Could not load saved profile for checkout pre-fill', err);
    customerProfile = {};
  }
}

// Live so a reward credited by the admin (or a previous order that used some
// credit) is always reflected before the customer checks out again.
function listenUserCredit(uid){
  db.collection('users').doc(uid).onSnapshot(doc=>{
    const data = doc.exists ? doc.data() : {};
    userCreditBalance = Number(data.creditBalance||0);
    updateCreditUI();
  }, err=>console.error('Could not load credit balance', err));
}

async function loadSiteSettings(){
  try{
    const doc = await db.collection('settings').doc('site').get();
    siteSettings = doc.exists ? doc.data() : {};
    if(siteSettings.tawkPropertyId && siteSettings.tawkWidgetId){
      loadTawkWidget(siteSettings.tawkPropertyId, siteSettings.tawkWidgetId);
    }
    // Cart/checkout totals may have already rendered with the old default
    // (no fee) before this settings fetch resolved — refresh them now that
    // the real shipping fee is known.
    renderCart();
  }catch(err){ console.error('Could not load payment settings', err); }
}

document.getElementById('signOutBtn').addEventListener('click', ()=>{
  auth.signOut().then(()=>{ window.location.href = 'login.html'; });
});

// ============================================================
// MOBILE NAV
// ============================================================
document.getElementById('menuToggle').addEventListener('click', ()=>{
  document.getElementById('navLinks').classList.toggle('open');
});

// ============================================================
// HEADER SEARCH
// ============================================================
const searchPanel = document.getElementById('searchPanel');
const searchInput = document.getElementById('searchInput');
document.getElementById('searchToggleBtn').addEventListener('click', ()=>{
  searchPanel.classList.toggle('open');
  if(searchPanel.classList.contains('open')) setTimeout(()=>searchInput.focus(), 150);
});
document.getElementById('searchCloseBtn').addEventListener('click', ()=>{
  searchPanel.classList.remove('open');
  searchInput.value = '';
  searchTerm = '';
  renderProductGrid();
});
searchInput.addEventListener('input', ()=>{
  searchTerm = searchInput.value.trim().toLowerCase();
  renderProductGrid();
});
searchInput.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape') document.getElementById('searchCloseBtn').click();
});

// ============================================================
// LOAD PRODUCTS (public, live)
// ============================================================
function listenProducts(){
  db.collection('products').orderBy('createdAt','desc').onSnapshot(snap=>{
    allProducts = [];
    snap.forEach(doc=> allProducts.push({id:doc.id, ...doc.data()}));
    pruneCartAgainstStock();
    renderFilters();
    renderCategorySlider();
    renderProductGrid();
    renderCart();
  }, err=>{
    console.error(err);
    document.getElementById('productGrid').innerHTML =
      '<div class="empty-state"><h3>Store not connected yet</h3><p>Check the Firebase config in firebase-config.js.</p></div>';
  });
}

function renderCategorySlider(){
  const wrap = document.getElementById('catSliderWrap');
  const track = document.getElementById('catSlider');
  const cats = [...new Set(allProducts.map(p=>p.category).filter(Boolean))];
  if(cats.length < 2){ wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  track.innerHTML = cats.map(c=>{
    const sample = allProducts.find(p=>p.category===c && p.imageUrl) || allProducts.find(p=>p.category===c);
    const img = sample ? productImg(sample.imageUrl) : PLACEHOLDER_IMAGE;
    return `
    <div class="cat-card" data-cat="${esc(c)}">
      <img src="${img}" alt="${esc(c)}" loading="lazy">
      <div class="cat-card-label">${esc(c)}</div>
    </div>`;
  }).join('');
  track.querySelectorAll('.cat-card').forEach(el=>{
    el.addEventListener('click', ()=>jumpToCategory(el.dataset.cat));
  });
}
function jumpToCategory(cat){
  activeCategory = cat;
  renderFilters();
  renderProductGrid();
  document.getElementById('shop').scrollIntoView({behavior:'smooth'});
}

function renderFilters(){
  const hasBestsellers = allProducts.some(p=>p.featured);
  if(activeCategory==='top' && !hasBestsellers) activeCategory = 'all';
  const cats = [...(hasBestsellers?['top']:[]), 'all', ...new Set(allProducts.map(p=>p.category).filter(Boolean))];
  const row = document.getElementById('filterRow');
  row.innerHTML = cats.map(c=>
    `<button class="chip ${c==='top'?'top-chip':''} ${c===activeCategory?'active':''}" data-cat="${c}">${c==='all'?'All':(c==='top'?'Top':c)}</button>`
  ).join('');
  row.querySelectorAll('.chip').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      activeCategory = btn.dataset.cat;
      renderFilters();
      renderProductGrid();
    });
  });
}

document.getElementById('sortSelect').addEventListener('change', (e)=>{
  sortBy = e.target.value;
  renderProductGrid();
});

function sortProducts(list){
  const sorted = [...list];
  if(sortBy==='price-asc') sorted.sort((a,b)=>Number(a.price||0)-Number(b.price||0));
  else if(sortBy==='price-desc') sorted.sort((a,b)=>Number(b.price||0)-Number(a.price||0));
  else if(sortBy==='name-asc') sorted.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  return sorted;
}

function renderProductGrid(){
  const grid = document.getElementById('productGrid');
  let list = activeCategory==='top' ? allProducts.filter(p=>p.featured)
    : (activeCategory==='all' ? allProducts : allProducts.filter(p=>p.category===activeCategory));
  if(searchTerm){
    list = list.filter(p=>
      (p.name||'').toLowerCase().includes(searchTerm) ||
      (p.category||'').toLowerCase().includes(searchTerm) ||
      (p.description||'').toLowerCase().includes(searchTerm)
    );
  }
  list = sortProducts(list);
  const countEl = document.getElementById('resultsCount');
  if(countEl) countEl.textContent = `Showing ${list.length} product${list.length===1?'':'s'}`;
  const hintEl = document.getElementById('searchHint');
  if(hintEl) hintEl.textContent = searchTerm ? `${list.length} match${list.length===1?'':'es'} for "${searchInput.value.trim()}"` : '';
  if(list.length === 0){
    grid.innerHTML = searchTerm
      ? `<div class="empty-state"><h3>No matches</h3><p>Try a different name or category — or clear the search.</p></div>`
      : `<div class="empty-state"><h3>Nothing here yet</h3><p>Check back soon — we're restocking the shelf.</p></div>`;
    return;
  }
  grid.innerHTML = list.map(p=>{
    const stock = availableStock(p, allProducts);
    const threshold = p.lowStock!=null ? Number(p.lowStock) : 5;
    const stockLabel = stock<=0 ? 'Sold out' : (stock<=threshold ? `${stock} left` : 'In stock');
    const hasDiscount = p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price);
    const bundleLine = p.isBundle ? `<p class="card-desc" style="color:var(--plum);">Includes: ${esc(bundleContentsLabel(p, allProducts))}</p>` : '';
    return `
    <div class="card glass" data-id="${p.id}">
      <div class="img-wrap" onclick="openProductModal('${p.id}')">
        ${p.featured ? '<span class="badge">Bestseller</span>' : (p.isBundle ? '<span class="badge">Bundle</span>' : '')}
        <span class="stock-badge">${stockLabel}</span>
        <img src="${productImg(p.imageUrl)}" alt="${esc(p.name)}" loading="lazy">
        <button class="quick-add" ${stock<=0?'disabled style="opacity:.5;cursor:not-allowed;bottom:10px;"':''} onclick="addToCart('${p.id}', event)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
          ${stock<=0?'Sold out':'Quick add'}
        </button>
      </div>
      <div class="card-body">
        <div class="card-cat-row">
          <div class="card-cat">${esc(p.category)||'Skincare'}</div>
          ${p.unit ? `<div class="card-unit">${esc(p.unit)}</div>` : ''}
        </div>
        <h3 class="card-name" onclick="openProductModal('${p.id}')">${esc(p.name)||'Untitled'}</h3>
        ${bundleLine || `<p class="card-desc">${esc((p.description||'').slice(0,80))}${(p.description||'').length>80?'…':''}</p>`}
        <div class="card-foot">
          <div class="price-block">
            ${hasDiscount ? `<span class="price-old">${money(p.compareAtPrice)}</span>` : ''}
            <span class="price">${money(p.price)}</span>
          </div>
          <button class="add-btn" ${stock<=0?'disabled style="opacity:.4;cursor:not-allowed;"':''} onclick="addToCart('${p.id}', event)" aria-label="Add to bag">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
            Add
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// PRODUCT MODAL
// ============================================================
function openProductModal(id){
  const p = allProducts.find(x=>x.id===id);
  if(!p) return;
  const stock = availableStock(p, allProducts);
  const hasDiscount = p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price);
  const bundleBlock = p.isBundle ? `<div style="font-size:13.5px; color:var(--plum); margin-bottom:10px;"><strong>Includes:</strong> ${esc(bundleContentsLabel(p, allProducts))}</div>` : '';
  document.getElementById('productModal').innerHTML = `
    <button class="close-x" onclick="closeProductModal()">✕</button>
    <div class="product-modal-grid">
      <img src="${productImg(p.imageUrl)}" alt="${esc(p.name)}">
      <div>
        <div class="card-cat-row"><div class="card-cat">${esc(p.category)||'Skincare'}</div>${p.unit ? `<div class="card-unit">${esc(p.unit)}</div>` : ''}</div>
        <h2 style="font-weight:500; margin:6px 0 10px;">${esc(p.name)}</h2>
        ${bundleBlock}
        <p style="color:var(--plum-soft); font-size:14px; line-height:1.7;">${esc(p.description)||'No description provided yet.'}</p>
        <div style="display:flex; align-items:baseline; gap:10px; margin:16px 0;">
          ${hasDiscount ? `<span class="price-old" style="font-size:15px;">${money(p.compareAtPrice)}</span>` : ''}
          <span style="font-size:22px; font-weight:800;">${money(p.price)}</span>
        </div>
        <div style="font-size:12.5px; color:var(--plum-soft); margin-bottom:16px;">${stock<=0?'Currently sold out':(stock+' in stock')}</div>
        <button class="full-btn" ${stock<=0?'disabled':''} onclick="addToCart('${p.id}'); closeProductModal();">Add to bag</button>
      </div>
    </div>`;
  document.getElementById('productModalOverlay').classList.add('show');
}
function closeProductModal(){ document.getElementById('productModalOverlay').classList.remove('show'); }
document.getElementById('productModalOverlay').addEventListener('click', e=>{
  if(e.target.id==='productModalOverlay') closeProductModal();
});

// ============================================================
// CART
// ============================================================
function addToCart(id, evt){
  if(evt) evt.stopPropagation();
  const p = allProducts.find(x=>x.id===id);
  if(!p) return;
  const stock = availableStock(p, allProducts);
  if(stock<=0) return;
  if((cart[id]||0) >= stock){
    toast(`Only ${stock} of ${p.name} in stock`);
    return;
  }
  cart[id] = (cart[id]||0) + 1;
  saveCart();
  renderCart();
  toast(`Added ${p.name} to your bag`);
}
function changeQty(id, delta){
  if(!cart[id]) return;
  const p = allProducts.find(x=>x.id===id);
  const stock = p ? availableStock(p, allProducts) : Infinity;
  if(delta > 0 && cart[id] >= stock){
    toast(`Only ${stock} in stock`);
    return;
  }
  cart[id] += delta;
  if(cart[id] <= 0) delete cart[id];
  saveCart();
  renderCart();
}
function removeFromCart(id){ delete cart[id]; saveCart(); renderCart(); }

function renderCart(){
  const ids = Object.keys(cart);
  document.getElementById('cartCount').textContent = ids.reduce((s,id)=>s+cart[id],0);
  const body = document.getElementById('cartBody');
  if(ids.length===0){
    body.innerHTML = '<p style="color:var(--plum-soft); text-align:center; margin-top:40px;">Your bag is empty.</p>';
    document.getElementById('cartSubtotal').textContent = money(0);
    document.getElementById('checkoutBtn').disabled = true;
    return;
  }
  let subtotal = 0;
  body.innerHTML = ids.map(id=>{
    const p = allProducts.find(x=>x.id===id);
    if(!p) return '';
    const lineTotal = p.price * cart[id];
    subtotal += lineTotal;
    return `
    <div class="cart-item">
      <img src="${productImg(p.imageUrl)}" alt="${esc(p.name)}">
      <div class="cart-item-info">
        <h5>${esc(p.name)}</h5>
        <div style="font-size:12.5px; color:var(--plum-soft);">${money(p.price)} each</div>
        <div class="qty-row">
          <button class="qty-btn" onclick="changeQty('${id}',-1)">−</button>
          <span>${cart[id]}</span>
          <button class="qty-btn" onclick="changeQty('${id}',1)">+</button>
          <span class="remove-link" onclick="removeFromCart('${id}')">Remove</span>
        </div>
      </div>
    </div>`;
  }).join('');
  document.getElementById('cartSubtotal').textContent = money(subtotal);
  const shippingRow = document.getElementById('cartShippingRow');
  const shippingFeeEl = document.getElementById('cartShippingFee');
  const shipping = currentShippingFee();
  if(shippingRow && shippingFeeEl){
    if(shipping > 0){
      shippingFeeEl.textContent = money(shipping);
      shippingRow.style.display = 'flex';
    } else {
      shippingRow.style.display = 'none';
    }
  }
  document.getElementById('checkoutBtn').disabled = false;
  updateCheckoutTotals();
}

document.getElementById('cartOpenBtn').addEventListener('click', ()=>{
  document.getElementById('cartDrawer').classList.add('show');
  document.getElementById('overlay').classList.add('show');
});
function closeCart(){
  document.getElementById('cartDrawer').classList.remove('show');
  document.getElementById('overlay').classList.remove('show');
}
document.getElementById('cartCloseBtn').addEventListener('click', closeCart);
document.getElementById('overlay').addEventListener('click', closeCart);

// ============================================================
// CHECKOUT
// ============================================================
document.getElementById('checkoutBtn').addEventListener('click', ()=>{
  if(Object.keys(cart).length===0) return;
  resetPaymentPicker();
  const creditBox = document.getElementById('applyCreditCheckbox');
  if(creditBox) creditBox.checked = false;
  document.querySelectorAll('#checkoutModalOverlay .medAckItem').forEach(cb=>cb.checked=false);
  prefillCheckoutFromProfile();
  updateCreditUI();
  document.getElementById('checkoutModalOverlay').classList.add('show');
});

// Fills in name/phone/address from the customer's saved profile — only
// into fields that are still empty, so it never overwrites something
// they've already typed (e.g. a different shipping address for this
// particular order). Email comes straight from their signed-in account.
function prefillCheckoutFromProfile(){
  const nameEl = document.getElementById('custName');
  const emailEl = document.getElementById('custEmail');
  const phoneEl = document.getElementById('custPhone');
  const addressEl = document.getElementById('custAddress');
  if(nameEl && !nameEl.value.trim() && customerProfile.name) nameEl.value = customerProfile.name;
  if(emailEl && !emailEl.value.trim() && auth.currentUser && auth.currentUser.email) emailEl.value = auth.currentUser.email;
  if(phoneEl && !phoneEl.value.trim() && customerProfile.phone) phoneEl.value = customerProfile.phone;
  if(addressEl && !addressEl.value.trim() && customerProfile.address) addressEl.value = customerProfile.address;
}

// ============================================================
// STORE CREDIT (referral rewards) AT CHECKOUT
// ============================================================
function currentCartSubtotal(){
  return Object.keys(cart).reduce((sum,id)=>{
    const p = allProducts.find(x=>x.id===id);
    return p ? sum + Number(p.price||0)*cart[id] : sum;
  }, 0);
}
function updateCreditUI(){
  const field = document.getElementById('creditApplyField');
  if(!field) return;
  field.style.display = userCreditBalance > 0 ? 'block' : 'none';
  const label = document.getElementById('applyCreditLabel');
  if(label) label.textContent = `Apply store credit (${money(userCreditBalance)} available)`;
  updateCheckoutTotals();
}
// The shop currently only offers one flat shipping fee (set by the admin
// in Settings), applied the same way regardless of courier or address —
// not calculated per-courier/per-distance.
function currentShippingFee(){
  return siteSettings.shippingFeeEnabled ? Number(siteSettings.shippingFee || 0) : 0;
}
function updateCheckoutTotals(){
  const box = document.getElementById('checkoutTotalsBox');
  if(!box) return;
  const subtotal = currentCartSubtotal();
  const shipping = currentShippingFee();
  const checkbox = document.getElementById('applyCreditCheckbox');
  const wantsCredit = checkbox ? checkbox.checked : false;
  const creditApplied = wantsCredit ? Math.min(userCreditBalance, subtotal + shipping) : 0;
  const total = Math.max(0, subtotal + shipping - creditApplied);
  const shippingLine = shipping > 0 ? ` + shipping ${money(shipping)}` : '';
  box.innerHTML = creditApplied > 0
    ? `Subtotal ${money(subtotal)}${shippingLine} − credit ${money(creditApplied)} = <strong style="color:var(--plum);">${money(total)}</strong>`
    : `Subtotal ${money(subtotal)}${shippingLine} — Total: <strong style="color:var(--plum);">${money(total)}</strong>`;
}
const applyCreditCheckboxEl = document.getElementById('applyCreditCheckbox');
if(applyCreditCheckboxEl) applyCreditCheckboxEl.addEventListener('change', updateCheckoutTotals);
document.getElementById('checkoutCloseBtn').addEventListener('click', ()=>{
  document.getElementById('checkoutModalOverlay').classList.remove('show');
});
// Enter key submits from any single-line field (not the address/notes
// textareas, where Enter should just add a line break).
['custName','custEmail','custPhone','custPaymentRef'].forEach(id=>{
  document.getElementById(id).addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){ e.preventDefault(); document.getElementById('submitOrderBtn').click(); }
  });
});

// ============================================================
// PAYMENT METHOD PICKER (GCash / Bank InstaPay)
// ============================================================
function resetPaymentPicker(){
  selectedPayMethod = null;
  document.getElementById('payMethodGcashBtn').classList.remove('active');
  document.getElementById('payMethodBankBtn').classList.remove('active');
  document.getElementById('payGcashBox').classList.remove('show');
  document.getElementById('payBankBox').classList.remove('show');
  document.getElementById('payRefField').style.display = 'none';
  document.getElementById('custPaymentRef').value = '';
}
function selectPayMethod(method){
  selectedPayMethod = method;
  document.getElementById('payMethodGcashBtn').classList.toggle('active', method==='gcash');
  document.getElementById('payMethodBankBtn').classList.toggle('active', method==='bank');
  document.getElementById('payGcashBox').classList.toggle('show', method==='gcash');
  document.getElementById('payBankBox').classList.toggle('show', method==='bank');
  document.getElementById('payRefField').style.display = 'block';

  if(method==='gcash'){
    document.getElementById('payGcashName').textContent = siteSettings.gcashName || 'Not set up yet — contact us to confirm';
    document.getElementById('payGcashNumber').textContent = siteSettings.gcashNumber || '—';
    const qr = document.getElementById('payGcashQR');
    if(siteSettings.gcashQR){ qr.src = siteSettings.gcashQR; qr.style.display = 'block'; }
    else { qr.style.display = 'none'; }
  } else {
    document.getElementById('payBankName').textContent = siteSettings.bankName || 'Not set up yet — contact us to confirm';
    document.getElementById('payBankAccountName').textContent = siteSettings.bankAccountName || '—';
    document.getElementById('payBankAccountNumber').textContent = siteSettings.bankAccountNumber || '—';
    const qr = document.getElementById('payBankQR');
    if(siteSettings.bankQR){ qr.src = siteSettings.bankQR; qr.style.display = 'block'; }
    else { qr.style.display = 'none'; }
  }
}
document.getElementById('payMethodGcashBtn').addEventListener('click', ()=>selectPayMethod('gcash'));
document.getElementById('payMethodBankBtn').addEventListener('click', ()=>selectPayMethod('bank'));

document.getElementById('submitOrderBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('custName').value.trim();
  const email = document.getElementById('custEmail').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const address = document.getElementById('custAddress').value.trim();
  const shippingMethod = document.getElementById('custShippingMethod').value;
  const notes = document.getElementById('custNotes').value.trim();
  const paymentRef = document.getElementById('custPaymentRef').value.trim();
  const msgBox = document.getElementById('checkoutMsg');

  if(!name || !phone || !address){
    msgBox.innerHTML = '<div class="form-msg err">Please fill in your name, phone, and delivery address.</div>';
    return;
  }
  if(!shippingMethod){
    msgBox.innerHTML = '<div class="form-msg err">Please choose a courier.</div>';
    return;
  }
  const medicalItems = document.querySelectorAll('#checkoutModalOverlay .medAckItem');
  const medicalAllChecked = medicalItems.length > 0 && Array.from(medicalItems).every(cb=>cb.checked);
  if(!medicalAllChecked){
    msgBox.innerHTML = '<div class="form-msg err">Please check all boxes in the Medical & Customer Acknowledgment above.</div>';
    document.querySelector('#checkoutModalOverlay .med-ack-card').scrollIntoView({behavior:'smooth', block:'center'});
    return;
  }
  // Stock can change (or a product can be removed) between adding to cart
  // and checking out — re-validate against current data before sending.
  for(const id of Object.keys(cart)){
    const p = allProducts.find(x=>x.id===id);
    if(!p){
      msgBox.innerHTML = '<div class="form-msg err">One of your items is no longer available — please review your bag.</div>';
      return;
    }
    const stock = availableStock(p, allProducts);
    if(cart[id] > stock){
      msgBox.innerHTML = `<div class="form-msg err">Only ${stock} of "${esc(p.name)}" left — please adjust your bag.</div>`;
      renderCart();
      return;
    }
  }
  const items = Object.keys(cart).map(id=>{
    const p = allProducts.find(x=>x.id===id);
    return { productId:id, name:p.name, price:p.price, costPrice:Number(p.costPrice||0), qty:cart[id] };
  });
  const subtotal = items.reduce((s,i)=>s+i.price*i.qty,0);
  const shippingFee = currentShippingFee();
  const creditCheckbox = document.getElementById('applyCreditCheckbox');
  const wantsCredit = creditCheckbox ? creditCheckbox.checked : false;
  // Best-effort preview using the live-synced balance — the actual amount
  // deducted is re-checked against the real balance inside the transaction
  // below so a stale balance in the browser can never overspend it.
  const previewCreditApplied = wantsCredit ? Math.min(userCreditBalance, subtotal + shippingFee) : 0;
  const previewTotal = Math.max(0, subtotal + shippingFee - previewCreditApplied);
  const paymentNeeded = previewTotal > 0;

  if(paymentNeeded && !selectedPayMethod){
    msgBox.innerHTML = '<div class="form-msg err">Please choose how you\'ll pay (GCash or Bank/InstaPay).</div>';
    return;
  }
  if(paymentNeeded && !paymentRef){
    msgBox.innerHTML = '<div class="form-msg err">Please enter the reference number from your payment so we can verify it.</div>';
    return;
  }

  const btn = document.getElementById('submitOrderBtn');
  btn.disabled = true; btn.textContent = 'Sending...';
  let finalTotal = 0, finalCreditApplied = 0;
  try{
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    const orderRef = db.collection('orders').doc();

    // Runs as a transaction so a stale/cached balance can never let someone
    // spend more credit than they actually have, and so the order is never
    // created without its credit deduction (or vice versa).
    await db.runTransaction(async (tx)=>{
      let creditApplied = 0;
      let userRef = null;
      let freshBalance = 0;
      if(uid && wantsCredit){
        userRef = db.collection('users').doc(uid);
        const userDoc = await tx.get(userRef);
        freshBalance = userDoc.exists ? Number(userDoc.data().creditBalance||0) : 0;
        creditApplied = Math.min(freshBalance, subtotal + shippingFee);
      }
      const total = Math.max(0, subtotal + shippingFee - creditApplied);
      const fullyCoveredByCredit = total <= 0;
      finalTotal = total;
      finalCreditApplied = creditApplied;

      // Guards against the rare case where the balance changed between the
      // preview above and this transaction's real read (e.g. a second tab,
      // or credit spent moments earlier) — without this, an order could be
      // created expecting payment with no payment method/reference on file,
      // since those fields were skipped as "not needed" in the preview.
      if(!fullyCoveredByCredit && (!selectedPayMethod || !paymentRef)){
        throw new Error('CREDIT_BALANCE_CHANGED');
      }

      if(creditApplied > 0){
        tx.update(userRef, { creditBalance: freshBalance - creditApplied });
      }
      tx.set(orderRef, {
        customerName:name, email, phone, address, shippingMethod, notes,
        items, subtotal, shippingFee, creditApplied, total,
        customerUid: uid,
        medicalAcknowledged: true,
        medicalAcknowledgedAt: firebase.firestore.FieldValue.serverTimestamp(),
        paymentMethod: fullyCoveredByCredit ? (selectedPayMethod || 'credit') : selectedPayMethod,
        paymentReference: paymentRef || null,
        paymentStatus: fullyCoveredByCredit ? 'verified' : 'submitted',
        status:'new', createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    let breakdown = `Subtotal ${money(subtotal)}`;
    if(shippingFee > 0) breakdown += ` + shipping ${money(shippingFee)}`;
    if(finalCreditApplied > 0) breakdown += ` − credit ${money(finalCreditApplied)}`;
    msgBox.innerHTML = `<div class="form-msg ok">Order request sent! ${breakdown} = <strong>${money(finalTotal)}</strong>. We will verify your payment and confirm shortly.</div>`;
    cart = {};
    saveCart();
    renderCart();
    setTimeout(()=>{
      document.getElementById('checkoutModalOverlay').classList.remove('show');
      closeCart();
      msgBox.innerHTML='';
      document.getElementById('custName').value='';
      document.getElementById('custEmail').value='';
      document.getElementById('custPhone').value='';
      document.getElementById('custAddress').value='';
      document.getElementById('custShippingMethod').value='';
      document.getElementById('custNotes').value='';
      resetPaymentPicker();
      if(creditCheckbox) creditCheckbox.checked = false;
      document.querySelectorAll('#checkoutModalOverlay .medAckItem').forEach(cb=>cb.checked=false);
    }, 1800);
  }catch(err){
    console.error(err);
    if(err && err.message === 'CREDIT_BALANCE_CHANGED'){
      msgBox.innerHTML = '<div class="form-msg err">Your store credit balance just changed and no longer fully covers this order — please choose a payment method for the remaining amount and try again.</div>';
      updateCreditUI();
    } else {
      msgBox.innerHTML = '<div class="form-msg err">Something went wrong sending your order. Please try again.</div>';
    }
  }
  btn.disabled = false; btn.textContent = 'Send order request';
});