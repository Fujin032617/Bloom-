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
let activeCategory = 'top';
let sortBy = 'newest';
let searchTerm = '';
let siteSettings = {};
let selectedPayMethod = null;

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

  listenProducts();
  loadSiteSettings();
});

async function loadSiteSettings(){
  try{
    const doc = await db.collection('settings').doc('site').get();
    siteSettings = doc.exists ? doc.data() : {};
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
    renderFilters();
    renderCategorySlider();
    renderProductGrid();
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
    const img = sample && sample.imageUrl ? sample.imageUrl : 'https://images.unsplash.com/photo-1556228720-195a672e8a03?q=80&w=800&auto=format&fit=crop';
    return `
    <div class="cat-card" onclick="jumpToCategory('${c.replace(/'/g,"\\'")}')">
      <img src="${img}" alt="${c}">
      <div class="cat-card-label">${c}</div>
    </div>`;
  }).join('');
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
    const stock = Number(p.stock||0);
    const threshold = p.lowStock!=null ? Number(p.lowStock) : 5;
    const stockLabel = stock<=0 ? 'Sold out' : (stock<=threshold ? `${stock} left` : 'In stock');
    const hasDiscount = p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price);
    return `
    <div class="card glass" data-id="${p.id}">
      <div class="img-wrap" onclick="openProductModal('${p.id}')">
        ${p.featured ? '<span class="badge">Bestseller</span>' : ''}
        <span class="stock-badge">${stockLabel}</span>
        <img src="${p.imageUrl || 'https://images.unsplash.com/photo-1556228720-195a672e8a03?q=80&w=800&auto=format&fit=crop'}" alt="${p.name||''}">
        <button class="quick-add" ${stock<=0?'disabled style="opacity:.5;cursor:not-allowed;bottom:10px;"':''} onclick="addToCart('${p.id}', event)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
          ${stock<=0?'Sold out':'Quick add'}
        </button>
      </div>
      <div class="card-body">
        <div class="card-cat-row">
          <div class="card-cat">${p.category||'Skincare'}</div>
          ${p.unit ? `<div class="card-unit">${p.unit}</div>` : ''}
        </div>
        <h3 class="card-name" onclick="openProductModal('${p.id}')">${p.name||'Untitled'}</h3>
        <p class="card-desc">${(p.description||'').slice(0,80)}${(p.description||'').length>80?'…':''}</p>
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
  const stock = Number(p.stock||0);
  const hasDiscount = p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price);
  document.getElementById('productModal').innerHTML = `
    <button class="close-x" onclick="closeProductModal()">✕</button>
    <div class="product-modal-grid">
      <img src="${p.imageUrl||''}" alt="${p.name||''}">
      <div>
        <div class="card-cat-row"><div class="card-cat">${p.category||'Skincare'}</div>${p.unit ? `<div class="card-unit">${p.unit}</div>` : ''}</div>
        <h2 style="font-weight:500; margin:6px 0 10px;">${p.name||''}</h2>
        <p style="color:var(--plum-soft); font-size:14px; line-height:1.7;">${p.description||'No description provided yet.'}</p>
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
  if(!p || Number(p.stock||0)<=0) return;
  cart[id] = (cart[id]||0) + 1;
  renderCart();
  toast(`Added ${p.name} to your bag`);
}
function changeQty(id, delta){
  if(!cart[id]) return;
  cart[id] += delta;
  if(cart[id] <= 0) delete cart[id];
  renderCart();
}
function removeFromCart(id){ delete cart[id]; renderCart(); }

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
      <img src="${p.imageUrl||''}" alt="">
      <div class="cart-item-info">
        <h5>${p.name}</h5>
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
  document.getElementById('checkoutBtn').disabled = false;
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
  document.getElementById('checkoutModalOverlay').classList.add('show');
});
document.getElementById('checkoutCloseBtn').addEventListener('click', ()=>{
  document.getElementById('checkoutModalOverlay').classList.remove('show');
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
  const notes = document.getElementById('custNotes').value.trim();
  const paymentRef = document.getElementById('custPaymentRef').value.trim();
  const msgBox = document.getElementById('checkoutMsg');

  if(!name || !phone || !address){
    msgBox.innerHTML = '<div class="form-msg err">Please fill in your name, phone, and delivery address.</div>';
    return;
  }
  if(!selectedPayMethod){
    msgBox.innerHTML = '<div class="form-msg err">Please choose how you\'ll pay (GCash or Bank/InstaPay).</div>';
    return;
  }
  if(!paymentRef){
    msgBox.innerHTML = '<div class="form-msg err">Please enter the reference number from your payment so we can verify it.</div>';
    return;
  }
  const items = Object.keys(cart).map(id=>{
    const p = allProducts.find(x=>x.id===id);
    return { productId:id, name:p.name, price:p.price, qty:cart[id] };
  });
  const total = items.reduce((s,i)=>s+i.price*i.qty,0);

  const btn = document.getElementById('submitOrderBtn');
  btn.disabled = true; btn.textContent = 'Sending...';
  try{
    await db.collection('orders').add({
      customerName:name, email, phone, address, notes, items, total,
      customerUid: auth.currentUser ? auth.currentUser.uid : null,
      paymentMethod: selectedPayMethod,
      paymentReference: paymentRef,
      paymentStatus: 'submitted',
      status:'new', createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    msgBox.innerHTML = '<div class="form-msg ok">Order request sent! We will verify your payment and confirm shortly.</div>';
    cart = {};
    renderCart();
    setTimeout(()=>{
      document.getElementById('checkoutModalOverlay').classList.remove('show');
      closeCart();
      msgBox.innerHTML='';
      document.getElementById('custName').value='';
      document.getElementById('custEmail').value='';
      document.getElementById('custPhone').value='';
      document.getElementById('custAddress').value='';
      document.getElementById('custNotes').value='';
      resetPaymentPicker();
    }, 1800);
  }catch(err){
    console.error(err);
    msgBox.innerHTML = '<div class="form-msg err">Something went wrong sending your order. Please try again.</div>';
  }
  btn.disabled = false; btn.textContent = 'Send order request';
});