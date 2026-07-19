// =====================================================================
// ADMIN.HTML — store management dashboard logic
// Requires firebase-config.js to be loaded first.
// Only accounts whose users/{uid} document has role:"admin" get in —
// see the setup notes in login.html for how to promote an account.
// =====================================================================

let allProducts = [];
let adminSearchTerm = '';
let editingProductId = null;
let selectedProductIds = new Set();
let bundleItemsDraft = []; // [{productId, qty}] while the edit-product modal is open in bundle mode

// ============================================================
// AUTH GATE
// ============================================================
requireRole(['admin'], (user)=>{
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('adminDashboard').style.display = 'grid';
  const avatar = document.getElementById('adminAvatar');
  if(avatar) avatar.textContent = (user.email||'A').charAt(0).toUpperCase();

  listenProducts();
  listenOrders();
  listenMovements();
  listenUsers();
  listenReferrals();
  loadSettingsIntoForm();
});

document.getElementById('signOutBtn').addEventListener('click', ()=>{
  auth.signOut().then(()=>{ window.location.href = 'login.html'; });
});

// ============================================================
// NAV BETWEEN PANELS
// ============================================================
document.querySelectorAll('.admin-nav-btn[data-panel]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.admin-nav-btn[data-panel]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.admin-panel').forEach(p=>p.style.display='none');
    document.getElementById(btn.dataset.panel).style.display='block';
    const searchBox = document.getElementById('adminSearchInput');
    if(searchBox){
      searchBox.placeholder = btn.dataset.panel === 'panelOrders' ? 'Search orders by customer or phone…' : 'Search products or orders…';
    }
  });
});

const adminSearchInput = document.getElementById('adminSearchInput');
if(adminSearchInput){
  adminSearchInput.addEventListener('input', ()=>{
    adminSearchTerm = adminSearchInput.value.trim().toLowerCase();
    renderAdminProducts();
    renderAdminOrders();
  });
}

// ============================================================
// PRODUCTS (live)
// ============================================================
function listenProducts(){
  db.collection('products').orderBy('createdAt','desc').onSnapshot(snap=>{
    allProducts = [];
    snap.forEach(doc=> allProducts.push({id:doc.id, ...doc.data()}));
    renderAdminProducts();
    renderStats();
    renderInventory();
  }, err=>console.error(err));
}

function renderStats(){
  const total = allProducts.length;
  const outOfStock = allProducts.filter(p=>availableStock(p, allProducts)<=0).length;
  const featured = allProducts.filter(p=>p.featured).length;
  // Bundles are excluded from inventory value — their value is already
  // counted once under the component products they're made of, so adding
  // the bundle's own price×availability on top would double-count it.
  const value = allProducts.filter(p=>!p.isBundle).reduce((s,p)=>s+(Number(p.price||0)*Number(p.stock||0)),0);
  document.getElementById('statRow').innerHTML = `
    <div class="stat-card"><div class="num">${total}</div><div class="label">Total products</div></div>
    <div class="stat-card"><div class="num">${outOfStock}</div><div class="label">Out of stock</div></div>
    <div class="stat-card"><div class="num">${featured}</div><div class="label">Featured</div></div>
    <div class="stat-card"><div class="num">${money(value)}</div><div class="label">Inventory value</div></div>
  `;
}

function renderAdminProducts(){
  const body = document.getElementById('adminProductBody');
  const liveIds = new Set(allProducts.map(p=>p.id));
  selectedProductIds.forEach(id=>{ if(!liveIds.has(id)) selectedProductIds.delete(id); });
  if(allProducts.length===0){
    body.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--plum-soft); padding:40px;">No products yet. Click "Add product" to create your first listing.</td></tr>`;
    renderBulkBar();
    return;
  }
  let rows = allProducts;
  if(adminSearchTerm){
    rows = rows.filter(p=>(p.name||'').toLowerCase().includes(adminSearchTerm) || (p.category||'').toLowerCase().includes(adminSearchTerm));
  }
  if(rows.length===0){
    body.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--plum-soft); padding:40px;">No products match "${adminSearchTerm}".</td></tr>`;
    renderBulkBar();
    return;
  }
  body.innerHTML = rows.map(p=>{
    // For bundles, "stock" is computed live from component products rather
    // than read off the product doc (bundles never store their own stock).
    const stock = availableStock(p, allProducts);
    const threshold = p.lowStock!=null ? Number(p.lowStock) : 5;
    const pillClass = stock<=0 ? 'out' : (stock<=threshold ? 'low' : 'in');
    const pillLabel = stock<=0 ? 'Out of stock' : (stock<=threshold ? stock+' left' : stock+' in stock');
    const checked = selectedProductIds.has(p.id) ? 'checked' : '';
    const cost = Number(p.costPrice||0);
    const price = Number(p.price||0);
    const marginPct = price>0 ? ((price-cost)/price*100) : 0;
    const marginLabel = cost>0 ? `${marginPct.toFixed(0)}%` : '—';
    const compareAt = Number(p.compareAtPrice||0);
    const hasDiscount = compareAt > price;
    const discountPct = hasDiscount ? Math.round((1 - price/compareAt) * 100) : 0;
    const discountLabel = hasDiscount ? `<span class="pill low">-${discountPct}%</span>` : '—';
    const bundleBadge = p.isBundle ? `<br><span class="pill in" style="margin-top:4px;">Bundle</span>` : '';
    const bundleContents = p.isBundle ? `<div style="font-size:11px; color:var(--plum-soft); margin-top:2px;">${esc(bundleContentsLabel(p, allProducts))}</div>` : '';
    return `
    <tr>
      <td><input type="checkbox" class="product-select-box" data-id="${p.id}" ${checked}></td>
      <td><div class="row-prod"><img src="${productImg(p.imageUrl)}" alt="">${esc(p.name)||'Untitled'}${bundleContents}</div>${bundleBadge}</td>
      <td>${esc(p.category)||'—'}</td>
      <td>${money(p.price)}</td>
      <td>${discountLabel}</td>
      <td>${cost>0 ? money(cost) : '—'}</td>
      <td>${marginLabel}</td>
      <td><span class="pill ${pillClass}">${pillLabel}</span></td>
      <td>${p.featured ? '★ Yes' : '—'}</td>
      <td>
        <button class="icon-btn" onclick="openEditModal('${p.id}')">Edit</button>
        ${hasDiscount ? `<button class="icon-btn" onclick="removeProductDiscount('${p.id}')">Remove discount</button>` : ''}
        <button class="icon-btn danger" onclick="deleteProduct('${p.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
  body.querySelectorAll('.product-select-box').forEach(box=>{
    box.addEventListener('change', ()=>{
      if(box.checked) selectedProductIds.add(box.dataset.id);
      else selectedProductIds.delete(box.dataset.id);
      renderBulkBar();
    });
  });
  renderBulkBar();
}

// ============================================================
// BULK PRODUCT ACTIONS
// ============================================================
function renderBulkBar(){
  const bar = document.getElementById('bulkBar');
  const label = document.getElementById('bulkCountLabel');
  const selectAll = document.getElementById('selectAllProducts');
  if(!bar) return;
  const count = selectedProductIds.size;
  bar.style.display = count>0 ? 'flex' : 'none';
  label.textContent = `${count} selected`;
  if(selectAll){
    const visibleIds = Array.from(document.querySelectorAll('.product-select-box')).map(b=>b.dataset.id);
    selectAll.checked = visibleIds.length>0 && visibleIds.every(id=>selectedProductIds.has(id));
  }
}
document.getElementById('selectAllProducts').addEventListener('change', (e)=>{
  document.querySelectorAll('.product-select-box').forEach(box=>{
    box.checked = e.target.checked;
    if(e.target.checked) selectedProductIds.add(box.dataset.id);
    else selectedProductIds.delete(box.dataset.id);
  });
  renderBulkBar();
});
document.getElementById('bulkClearBtn').addEventListener('click', ()=>{
  selectedProductIds.clear();
  renderAdminProducts();
});
// Runs one write per id and reports how many actually succeeded, instead of
// letting Promise.all reject silently and leave the admin with no feedback
// and no idea which items (if any) were updated.
async function runBulkWrites(ids, writeFn){
  const results = await Promise.allSettled(ids.map(writeFn));
  const failed = results.filter(r=>r.status==='rejected');
  return { succeeded: ids.length - failed.length, failed: failed.length, firstError: failed[0] && failed[0].reason };
}

document.getElementById('bulkFeatureBtn').addEventListener('click', async ()=>{
  const ids = Array.from(selectedProductIds);
  const { succeeded, failed, firstError } = await runBulkWrites(ids, id=>db.collection('products').doc(id).update({featured:true}));
  if(failed>0){
    alert(`Marked ${succeeded} product${succeeded===1?'':'s'} as featured, but ${failed} failed: ${firstError && firstError.message}`);
  } else {
    toast(`Marked ${succeeded} product${succeeded===1?'':'s'} as featured`);
  }
});
document.getElementById('bulkUnfeatureBtn').addEventListener('click', async ()=>{
  const ids = Array.from(selectedProductIds);
  const { succeeded, failed, firstError } = await runBulkWrites(ids, id=>db.collection('products').doc(id).update({featured:false}));
  if(failed>0){
    alert(`Removed featured from ${succeeded} product${succeeded===1?'':'s'}, but ${failed} failed: ${firstError && firstError.message}`);
  } else {
    toast(`Removed featured from ${succeeded} product${succeeded===1?'':'s'}`);
  }
});
document.getElementById('bulkDiscountBtn').addEventListener('click', async ()=>{
  const raw = prompt('Apply what percent discount to the selected products? (e.g. 15 for 15% off)');
  if(raw === null) return; // user cancelled — do nothing, no error
  const pct = parseFloat(raw);
  if(!pct || pct<=0 || pct>=100){ alert('Enter a percentage between 1 and 99.'); return; }
  const ids = Array.from(selectedProductIds);
  const { succeeded, failed, firstError } = await runBulkWrites(ids, async id=>{
    const p = allProducts.find(x=>x.id===id);
    if(!p) return;
    const basePrice = p.compareAtPrice ? Number(p.compareAtPrice) : Number(p.price);
    const newPrice = Math.round(basePrice * (1 - pct/100) * 100) / 100;
    await db.collection('products').doc(id).update({ compareAtPrice: basePrice, price: newPrice });
  });
  if(failed>0){
    alert(`Applied ${pct}% discount to ${succeeded} product${succeeded===1?'':'s'}, but ${failed} failed: ${firstError && firstError.message}`);
  } else {
    toast(`Applied ${pct}% discount to ${succeeded} product${succeeded===1?'':'s'}`);
  }
});
document.getElementById('bulkDeleteBtn').addEventListener('click', async ()=>{
  const ids = Array.from(selectedProductIds);
  if(ids.length===0) return;
  // Same dependency check deleteProduct() runs for a single item — combined
  // across the whole selection, so bulk-deleting a bundle's component (or
  // something tied up in an open order) can't slip through unwarned just
  // because it went through the checkbox+bulk-bar path instead.
  let combinedWarning = '';
  let warnedCount = 0;
  ids.forEach(id=>{
    const w = productDeleteWarning(id, allProducts.find(p=>p.id===id));
    if(w){ warnedCount++; combinedWarning += w; }
  });
  const baseMsg = `Delete ${ids.length} selected product${ids.length===1?'':'s'}? This cannot be undone.`;
  const msg = warnedCount
    ? `${baseMsg}\n\n${warnedCount} of the selected product${warnedCount===1?' is':'s are'} used in a bundle and/or an open order:${combinedWarning}\n\nDelete anyway?`
    : baseMsg;
  if(!confirm(msg)) return;
  const { succeeded, failed, firstError } = await runBulkWrites(ids, id=>db.collection('products').doc(id).delete());
  selectedProductIds.clear();
  if(failed>0){
    alert(`Deleted ${succeeded} product${succeeded===1?'':'s'}, but ${failed} failed: ${firstError && firstError.message}`);
  } else {
    toast('Selected products deleted');
  }
});

document.getElementById('bulkRemoveDiscountBtn').addEventListener('click', async ()=>{
  const ids = Array.from(selectedProductIds).filter(id=>{
    const p = allProducts.find(x=>x.id===id);
    return p && Number(p.compareAtPrice||0) > Number(p.price||0);
  });
  if(ids.length===0){ toast('None of the selected products have a discount'); return; }
  const { succeeded, failed, firstError } = await runBulkWrites(ids, async id=>{
    const p = allProducts.find(x=>x.id===id);
    await db.collection('products').doc(id).update({ price: Number(p.compareAtPrice), compareAtPrice: null });
  });
  if(failed>0){
    alert(`Removed discount from ${succeeded} product${succeeded===1?'':'s'}, but ${failed} failed: ${firstError && firstError.message}`);
  } else {
    toast(`Removed discount from ${succeeded} product${succeeded===1?'':'s'}`);
  }
});
async function removeProductDiscount(id){
  const p = allProducts.find(x=>x.id===id);
  if(!p || !(Number(p.compareAtPrice||0) > Number(p.price||0))) return;
  try{
    await db.collection('products').doc(id).update({ price: Number(p.compareAtPrice), compareAtPrice: null });
    toast('Discount removed');
  }catch(err){ alert(err.message); }
}

// Shared by deleteProduct (single) and bulkDeleteBtn (multi) — checks
// whether deleting this product would silently break a bundle it's part
// of, or leave an open order unable to deduct stock for it correctly.
function productDeleteWarning(id, product){
  const dependentBundles = allProducts.filter(p =>
    p.isBundle && Array.isArray(p.bundleItems) && p.bundleItems.some(bi => bi.productId === id)
  );
  let dependentOrderCount = 0;
  try{
    const openOrders = (window._orders||[]).filter(o => !['done','cancelled','returned','damaged'].includes(o.status||'new'));
    dependentOrderCount = openOrders.filter(o => (o.items||[]).some(i => i.productId === id)).length;
  }catch(e){ /* window._orders may not be loaded yet — skip this check */ }

  let warning = '';
  if(dependentBundles.length){
    warning += `\n\nThis product is used in ${dependentBundles.length} bundle${dependentBundles.length===1?'':'s'} (${dependentBundles.map(b=>b.name).join(', ')}). Deleting it will make ${dependentBundles.length===1?'that bundle':'those bundles'} permanently show 0 available.`;
  }
  if(dependentOrderCount){
    warning += `\n\nThis product also appears in ${dependentOrderCount} open (not yet shipped/fulfilled) order${dependentOrderCount===1?'':'s'}. If ${dependentOrderCount===1?'that order is':'those orders are'} later marked Shipped, stock for this item won't be deducted correctly.`;
  }
  return warning;
}

async function deleteProduct(id){
  const product = allProducts.find(p=>p.id===id);
  const warning = productDeleteWarning(id, product);

  const msg = warning
    ? `Delete "${product ? product.name : 'this product'}"?${warning}\n\nDelete anyway?`
    : 'Delete this product? This cannot be undone.';
  if(!confirm(msg)) return;

  try{
    await db.collection('products').doc(id).delete();
    toast('Product deleted');
  }catch(err){ alert(err.message); }
}

// ============================================================
// INVENTORY
// ============================================================
window._movements = [];
function listenMovements(){
  db.collection('stockMovements').orderBy('createdAt','desc').limit(50).onSnapshot(snap=>{
    window._movements = [];
    snap.forEach(doc=> window._movements.push({id:doc.id, ...doc.data()}));
    renderMovements();
  }, err=>console.error(err));
}

// Adjusts a product's stock by delta (positive to restock, negative to remove/correct)
// and writes an entry to the stockMovements log. Uses a transaction so concurrent
// adjustments (or a sale happening at the same time) never overwrite each other.
// Returns {ok:true} on success or {ok:false, error} on failure — callers
// that loop over multiple items (ensureStockDeducted, restoreStockForOrder,
// deleteOrder, manual sales) use this to know whether they can safely
// treat the whole batch as done, instead of the old version which only
// ever alert()ed and let the loop continue as if nothing happened. That
// used to be a real gap: those callers set their guard flag
// (stockDeducted/stockRestored) BEFORE looping, so if one item's product
// had been deleted mid-loop, that single item's stock silently never got
// reconciled and the flag was already true — no retry would ever catch it.
async function adjustStock(productId, delta, reason){
  const productRef = db.collection('products').doc(productId);
  try{
    let newStock, productName, wentNegative;
    await db.runTransaction(async (tx)=>{
      const doc = await tx.get(productRef);
      if(!doc.exists) throw new Error('Product no longer exists');
      const current = Number(doc.data().stock||0);
      const raw = current + delta;
      wentNegative = raw < 0;
      newStock = Math.max(0, raw);
      productName = doc.data().name;
      tx.update(productRef, {stock:newStock});
    });
    await db.collection('stockMovements').add({
      productId, productName, qtyChange:delta, reason: reason||'Manual adjustment',
      resultingStock:newStock, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if(wentNegative){
      // More units were deducted than were actually in stock — e.g. two
      // orders for the last item were both marked "Shipped" before either
      // deduction caught up with the other. Stock is still floored at 0
      // (never goes negative in Firestore), but the admin needs to know
      // they're oversold so they can follow up on whichever order can't
      // actually be fulfilled.
      toast(`⚠️ "${productName}" is oversold — stock floored at 0. Check recent orders for this item.`);
    } else {
      toast(delta>=0 ? `Added ${delta} to stock` : `Removed ${Math.abs(delta)} from stock`);
    }
    return { ok:true };
  }catch(err){
    alert(err.message);
    return { ok:false, error: err };
  }
}

// Runs adjustStock for every item in a list and reports which (if any)
// failed, so a caller can decide whether it's still safe to consider the
// whole batch reconciled (e.g. keep its guard flag flipped) or needs to
// surface a warning instead of silently moving on.
async function adjustStockBatch(items, reasonFor){
  const failures = [];
  for(const item of items){
    const reason = typeof reasonFor === 'function' ? reasonFor(item) : reasonFor;
    const result = await adjustStock(item.productId, item.qty, reason);
    if(!result.ok) failures.push(item);
  }
  return failures;
}

function quickAdjust(productId, sign){
  const input = document.getElementById('qtyInput-'+productId);
  const qty = parseInt(input.value) || 1;
  adjustStock(productId, sign*qty, sign>0 ? 'Restock' : 'Manual correction');
  input.value = '';
}

function renderInventory(){
  const body = document.getElementById('adminInventoryBody');
  if(!body) return;
  // Bundles don't get a row here with +/- buttons — there's nothing to
  // manually restock, since their availability is derived from the
  // component products (which DO show up here, with their own controls).
  // They're listed separately below as a read-only reference instead.
  const singleProducts = allProducts.filter(p=>!p.isBundle);
  const bundles = allProducts.filter(p=>p.isBundle);
  if(singleProducts.length===0){
    body.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--plum-soft); padding:40px;">No products yet — add one from the Products tab first.</td></tr>`;
  } else {
    body.innerHTML = singleProducts.map(p=>{
      const stock = Number(p.stock||0);
      const threshold = p.lowStock!=null ? Number(p.lowStock) : 5;
      const pillClass = stock<=0 ? 'out' : (stock<=threshold ? 'low' : 'in');
      const pillLabel = stock<=0 ? 'Out of stock' : (stock<=threshold ? 'Low stock' : 'Healthy');
      return `
      <tr>
        <td><div class="row-prod"><img src="${productImg(p.imageUrl)}" alt="">${esc(p.name)||'Untitled'}</div></td>
        <td><strong>${stock}</strong></td>
        <td>${threshold}</td>
        <td><span class="pill ${pillClass}">${pillLabel}</span></td>
        <td>
          <div class="qty-adjust">
            <input type="number" min="1" placeholder="qty" id="qtyInput-${p.id}">
            <button class="mini-btn" onclick="quickAdjust('${p.id}',1)">+ Restock</button>
            <button class="mini-btn subtract" onclick="quickAdjust('${p.id}',-1)">− Remove</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }
  if(bundles.length>0){
    body.innerHTML += `<tr><td colspan="5" style="padding-top:18px; padding-bottom:6px; color:var(--plum-soft); font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px;">Bundles (stock comes from the components above)</td></tr>`;
    body.innerHTML += bundles.map(p=>{
      const stock = availableStock(p, allProducts);
      const pillClass = stock<=0 ? 'out' : 'in';
      const pillLabel = stock<=0 ? 'Out of stock' : `${stock} assemblable now`;
      return `
      <tr>
        <td><div class="row-prod"><img src="${productImg(p.imageUrl)}" alt="">${esc(p.name)||'Untitled'}</div></td>
        <td><strong>${stock}</strong></td>
        <td>—</td>
        <td><span class="pill ${pillClass}">${pillLabel}</span></td>
        <td style="color:var(--plum-soft); font-size:12px;">Edit the bundle's items in the Products tab to change this.</td>
      </tr>`;
    }).join('');
  }

  // Totals only count real (non-bundle) products — a bundle's units/value
  // are already counted once under its components, so including bundles
  // here too would double-count both.
  const totalUnits = singleProducts.reduce((s,p)=>s+Number(p.stock||0),0);
  const lowCount = singleProducts.filter(p=>{
    const stock = Number(p.stock||0);
    const threshold = p.lowStock!=null ? Number(p.lowStock) : 5;
    return stock>0 && stock<=threshold;
  }).length;
  const outCount = singleProducts.filter(p=>Number(p.stock||0)<=0).length;
  const invValue = singleProducts.reduce((s,p)=>s+(Number(p.price||0)*Number(p.stock||0)),0);
  document.getElementById('inventoryStatRow').innerHTML = `
    <div class="stat-card"><div class="num">${totalUnits}</div><div class="label">Units in stock</div></div>
    <div class="stat-card"><div class="num">${lowCount}</div><div class="label">Low stock items</div></div>
    <div class="stat-card"><div class="num">${outCount}</div><div class="label">Out of stock</div></div>
    <div class="stat-card"><div class="num">${money(invValue)}</div><div class="label">Inventory value</div></div>
  `;
}

function renderMovements(){
  const body = document.getElementById('adminMovementBody');
  if(!body) return;
  const moves = window._movements||[];
  if(moves.length===0){
    body.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--plum-soft); padding:40px;">No stock activity yet.</td></tr>`;
    return;
  }
  body.innerHTML = moves.map(m=>{
    const date = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate().toLocaleString() : '—';
    const changeLabel = m.qtyChange>=0 ? `+${m.qtyChange}` : `${m.qtyChange}`;
    const changeColor = m.qtyChange>=0 ? '#2c6e49' : '#a13333';
    return `
    <tr>
      <td>${esc(m.productName)||'—'}</td>
      <td style="color:${changeColor}; font-weight:700;">${changeLabel}</td>
      <td>${esc(m.reason)||'—'}</td>
      <td>${m.resultingStock!=null ? m.resultingStock : '—'}</td>
      <td>${date}</td>
    </tr>`;
  }).join('');
}

// ============================================================
// ADD / EDIT PRODUCT MODAL
// ============================================================
function openEditModal(id){
  editingProductId = id || null;
  const p = id ? allProducts.find(x=>x.id===id) : null;
  document.getElementById('editModalTitle').textContent = id ? 'Edit product' : 'Add product';
  document.getElementById('editName').value = p ? p.name||'' : '';
  document.getElementById('editCategory').value = p ? p.category||'' : '';
  document.getElementById('editUnit').value = p ? p.unit||'' : '';
  document.getElementById('editPrice').value = p ? p.price||'' : '';
  document.getElementById('editCompareAtPrice').value = p && p.compareAtPrice ? p.compareAtPrice : '';
  document.getElementById('editDiscountPct').value = '';
  document.getElementById('editStock').value = p ? p.stock||0 : '';
  document.getElementById('editLowStock').value = p ? (p.lowStock!=null ? p.lowStock : 5) : 5;
  document.getElementById('editCostPrice').value = p && p.costPrice!=null ? p.costPrice : '';
  document.getElementById('editFeatured').value = p && p.featured ? 'true' : 'false';
  document.getElementById('editDescription').value = p ? p.description||'' : '';
  document.getElementById('editMsg').innerHTML = '';

  document.getElementById('editIsBundle').value = p && p.isBundle ? 'true' : 'false';
  bundleItemsDraft = (p && Array.isArray(p.bundleItems)) ? p.bundleItems.map(c=>({productId:c.productId, qty:Number(c.qty||1)})) : [];
  applyBundleModeUI();
  renderBundleItemRows();

  wireImageUpload({
    fileInputId:'editImageFile', previewId:'editImagePreview', urlFieldId:'editImage',
    progressId:'editImageProgress', folder:'products', existingUrl: p ? p.imageUrl||'' : ''
  });
  updateDiscountPreview();
  document.getElementById('editModalOverlay').classList.add('show');
}
document.getElementById('addProductBtn').addEventListener('click', ()=>openEditModal(null));
document.getElementById('editCloseBtn').addEventListener('click', ()=>{
  document.getElementById('editModalOverlay').classList.remove('show');
});

// ------------------------------------------------------------
// Bundle / package editor (inside the add/edit product modal)
// A bundle has no stock field of its own — swap the stock inputs out for
// the "what's inside" editor whenever "Product type" is set to Bundle.
// ------------------------------------------------------------
function applyBundleModeUI(){
  const isBundle = document.getElementById('editIsBundle').value === 'true';
  document.getElementById('singleStockFields').style.display = isBundle ? 'none' : 'grid';
  document.getElementById('bundleItemsFields').style.display = isBundle ? 'block' : 'none';
}
document.getElementById('editIsBundle').addEventListener('change', ()=>{
  applyBundleModeUI();
  renderBundleItemRows();
});

function addBundleItemRow(){
  // Bundles can only contain real, single-stock products — not other
  // bundles, to keep stock math from having to recurse.
  const candidates = allProducts.filter(x=>!x.isBundle);
  const first = candidates[0];
  bundleItemsDraft.push({ productId: first ? first.id : '', qty: 1 });
  renderBundleItemRows();
}
document.getElementById('addBundleItemBtn').addEventListener('click', addBundleItemRow);

function removeBundleItemRow(i){
  bundleItemsDraft.splice(i,1);
  renderBundleItemRows();
}

function renderBundleItemRows(){
  const wrap = document.getElementById('bundleItemsList');
  if(!wrap) return;
  const candidates = allProducts.filter(x=>!x.isBundle);
  if(candidates.length===0){
    wrap.innerHTML = `<p style="color:var(--plum-soft); font-size:13px;">Add some regular products first — a bundle is made of those.</p>`;
  } else if(bundleItemsDraft.length===0){
    wrap.innerHTML = `<p style="color:var(--plum-soft); font-size:13px;">No items yet — add one below.</p>`;
  } else {
    wrap.innerHTML = bundleItemsDraft.map((it,i)=>{
      const options = candidates.map(x=>`<option value="${x.id}" ${x.id===it.productId?'selected':''}>${esc(x.name)||'Untitled'}</option>`).join('');
      return `
      <div class="repeat-row">
        <div class="field" style="flex:2;"><label>Product</label><select class="bundle-item-product" data-i="${i}">${options}</select></div>
        <div class="field" style="max-width:90px;"><label>Qty</label><input type="number" min="1" class="bundle-item-qty" data-i="${i}" value="${it.qty}"></div>
        <button type="button" class="remove-row-btn" onclick="removeBundleItemRow(${i})">Remove</button>
      </div>`;
    }).join('');
  }
  wrap.querySelectorAll('.bundle-item-product').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      bundleItemsDraft[Number(sel.dataset.i)].productId = sel.value;
      updateBundlePreview();
    });
  });
  wrap.querySelectorAll('.bundle-item-qty').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      bundleItemsDraft[Number(inp.dataset.i)].qty = parseInt(inp.value)||1;
      updateBundlePreview();
    });
  });
  updateBundlePreview();
}

function updateBundlePreview(){
  const availEl = document.getElementById('bundleAvailablePreview');
  const costEl = document.getElementById('bundleCostSuggestion');
  const useCostBtn = document.getElementById('useBundleCostBtn');
  if(!availEl) return;
  const validItems = bundleItemsDraft.filter(it=>it.productId);
  if(validItems.length===0){
    availEl.textContent = '';
    costEl.textContent = '';
    useCostBtn.style.display = 'none';
    return;
  }
  const fakeBundle = { isBundle:true, bundleItems: validItems };
  const avail = bundleAvailableQty(fakeBundle, allProducts);
  availEl.textContent = `Could assemble ${avail} of this bundle right now, based on current component stock.`;

  const suggestedCost = validItems.reduce((s,it)=>{
    const cp = allProducts.find(x=>x.id===it.productId);
    return s + (cp ? Number(cp.costPrice||0) : 0) * Number(it.qty||0);
  }, 0);
  costEl.textContent = `Sum of component cost prices: ${money(suggestedCost)} — used automatically if you leave Cost price blank.`;
  useCostBtn.style.display = 'inline-block';
  useCostBtn.onclick = ()=>{ document.getElementById('editCostPrice').value = suggestedCost.toFixed(2); };
}

// ------------------------------------------------------------
// Quick discount controls (inside the add/edit product modal)
// ------------------------------------------------------------
function updateDiscountPreview(){
  const preview = document.getElementById('discountPreview');
  const price = parseFloat(document.getElementById('editPrice').value) || 0;
  const compareAt = parseFloat(document.getElementById('editCompareAtPrice').value) || 0;
  if(compareAt > price && price > 0){
    const pct = Math.round((1 - price/compareAt) * 100);
    preview.textContent = `Currently ${pct}% off — was ${money(compareAt)}, now ${money(price)}.`;
  } else {
    preview.textContent = 'No discount applied.';
  }
}
document.getElementById('editPrice').addEventListener('input', updateDiscountPreview);
document.getElementById('editCompareAtPrice').addEventListener('input', updateDiscountPreview);
document.getElementById('applyDiscountBtn').addEventListener('click', ()=>{
  const pct = parseFloat(document.getElementById('editDiscountPct').value);
  if(!pct || pct<=0 || pct>=100){ alert('Enter a percentage between 1 and 99.'); return; }
  const priceField = document.getElementById('editPrice');
  const compareField = document.getElementById('editCompareAtPrice');
  // Base off the existing compare-at price if there's already one set, so
  // re-applying a discount doesn't discount an already-discounted price.
  const basePrice = parseFloat(compareField.value) || parseFloat(priceField.value) || 0;
  if(basePrice<=0){ alert('Enter a selling price first.'); return; }
  const newPrice = Math.round(basePrice * (1 - pct/100) * 100) / 100;
  compareField.value = basePrice;
  priceField.value = newPrice;
  document.getElementById('editDiscountPct').value = '';
  updateDiscountPreview();
});
document.getElementById('clearDiscountBtn').addEventListener('click', ()=>{
  const priceField = document.getElementById('editPrice');
  const compareField = document.getElementById('editCompareAtPrice');
  const compareAt = parseFloat(compareField.value) || 0;
  if(compareAt > 0) priceField.value = compareAt;
  compareField.value = '';
  document.getElementById('editDiscountPct').value = '';
  updateDiscountPreview();
});

document.getElementById('saveProductBtn').addEventListener('click', async ()=>{
  const imgProgress = document.getElementById('editImageProgress');
  if(imgProgress && imgProgress.style.display!=='none' && imgProgress.textContent.startsWith('Uploading')){
    document.getElementById('editMsg').innerHTML = '<div class="form-msg err">Please wait for the photo to finish uploading.</div>';
    return;
  }
  const name = document.getElementById('editName').value.trim();
  const category = document.getElementById('editCategory').value.trim();
  const unit = document.getElementById('editUnit').value.trim();
  const price = Math.max(0, parseFloat(document.getElementById('editPrice').value) || 0);
  const costPriceRaw = document.getElementById('editCostPrice').value.trim();
  const costPrice = costPriceRaw ? Math.max(0, parseFloat(costPriceRaw) || 0) : 0;
  const compareAtPriceRaw = document.getElementById('editCompareAtPrice').value.trim();
  const compareAtPrice = compareAtPriceRaw ? Math.max(0, parseFloat(compareAtPriceRaw) || 0) : null;
  const featured = document.getElementById('editFeatured').value === 'true';
  const imageUrl = document.getElementById('editImage').value.trim();
  const description = document.getElementById('editDescription').value.trim();
  const msg = document.getElementById('editMsg');
  const isBundle = document.getElementById('editIsBundle').value === 'true';

  if(!name || !price){
    msg.innerHTML = '<div class="form-msg err">Product name and price are required.</div>';
    return;
  }

  let data;
  if(isBundle){
    const items = bundleItemsDraft
      .filter(it=>it.productId && Number(it.qty)>0)
      .map(it=>{
        const cp = allProducts.find(x=>x.id===it.productId);
        return { productId: it.productId, name: cp ? cp.name : 'Item', qty: Number(it.qty) };
      });
    if(items.length===0){
      msg.innerHTML = '<div class="form-msg err">Add at least one item to this bundle.</div>';
      return;
    }
    // If the admin never entered (or clicked "Use this as cost price" for)
    // a cost, don't silently save it as 0 — that would overstate profit on
    // every bundle sale. Fall back to the sum of the components' own cost
    // prices, same number the "Use this as cost price" button would apply.
    let finalBundleCostPrice = costPrice;
    if(finalBundleCostPrice <= 0){
      finalBundleCostPrice = items.reduce((s,it)=>{
        const cp = allProducts.find(x=>x.id===it.productId);
        return s + (cp ? Number(cp.costPrice||0) : 0) * Number(it.qty||0);
      }, 0);
    }
    // Bundles carry isBundle/bundleItems instead of stock/lowStock — their
    // availability is computed live from those items' own stock.
    data = { name, category, unit, price, costPrice: finalBundleCostPrice, compareAtPrice, featured, imageUrl, description,
      isBundle: true, bundleItems: items, stock: null, lowStock: null };
  } else {
    const stock = Math.max(0, parseInt(document.getElementById('editStock').value) || 0);
    const lowStock = Math.max(0, parseInt(document.getElementById('editLowStock').value) || 5);
    data = { name, category, unit, price, costPrice, compareAtPrice, stock, lowStock, featured, imageUrl, description,
      isBundle: false, bundleItems: null };
  }
  try{
    if(editingProductId){
      await db.collection('products').doc(editingProductId).update(data);
      toast('Product updated');
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('products').add(data);
      toast('Product added');
    }
    document.getElementById('editModalOverlay').classList.remove('show');
  }catch(err){
    msg.innerHTML = `<div class="form-msg err">${err.message}</div>`;
  }
});

// ============================================================
// ORDERS
// ============================================================
function listenOrders(){
  db.collection('orders').orderBy('createdAt','desc').onSnapshot(snap=>{
    window._orders = [];
    snap.forEach(doc=> window._orders.push({id:doc.id, ...doc.data()}));
    renderAdminOrders();
    renderSalesDashboard();
  }, err=>console.error(err));
}
const ORDER_STATUSES = ['new','confirmed','processing','shipped','done','cancelled','returned','damaged'];
const ORDER_STATUS_LABELS = {new:'New', confirmed:'Confirmed', processing:'Processing', shipped:'Shipped', done:'Fulfilled', cancelled:'Cancelled', returned:'Returned to seller', damaged:'Damaged / write-off'};
// Statuses that deduct stock the first time an order reaches them (guarded
// by the stockDeducted flag below so it only ever happens once).
const STOCK_DEDUCTING_STATUSES = ['shipped','done'];

function renderAdminOrders(){
  const body = document.getElementById('adminOrderBody');
  if(!body) return;
  let orders = window._orders || [];
  if(orders.length===0){
    body.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--plum-soft); padding:40px;">No orders yet.</td></tr>`;
    return;
  }
  if(adminSearchTerm){
    orders = orders.filter(o=>(o.customerName||'').toLowerCase().includes(adminSearchTerm) || (o.phone||'').toLowerCase().includes(adminSearchTerm));
  }
  if(orders.length===0){
    body.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--plum-soft); padding:40px;">No orders match "${adminSearchTerm}".</td></tr>`;
    return;
  }
  body.innerHTML = orders.map(o=>{
    const itemSummary = (o.items||[]).map(i=>`${esc(i.qty)}× ${esc(i.name)}`).join(', ');
    const date = o.createdAt && o.createdAt.toDate ? o.createdAt.toDate().toLocaleDateString() : '—';
    const status = o.status || 'new';
    const options = ORDER_STATUSES.map(s=>`<option value="${s}" ${s===status?'selected':''}>${ORDER_STATUS_LABELS[s]}</option>`).join('');
    const payStatus = o.paymentStatus || (o.paymentMethod ? 'submitted' : 'unpaid');
    const payLabel = payStatus==='verified' ? 'Verified' : (payStatus==='submitted' ? 'Submitted' : 'No payment info');
    const methodLabel = o.paymentMethod === 'gcash' ? 'GCash' : (o.paymentMethod === 'bank' ? 'Bank/InstaPay' : (o.paymentMethod === 'manual' ? 'Manual' : (o.paymentMethod === 'credit' ? 'Store credit' : '—')));
    const manualBadge = o.source==='manual' ? `<span class="pill source-manual">Manual sale</span><br>` : '';
    return `
    <tr>
      <td>${manualBadge}<strong>${esc(o.customerName)||'—'}</strong><br><span style="color:var(--plum-soft); font-size:12px;">${esc(o.phone)}</span></td>
      <td style="max-width:220px;">${itemSummary}</td>
      <td>${money(o.total)}</td>
      <td>
        <span class="pill pay-${payStatus}">${payLabel}</span><br>
        <span style="font-size:11.5px; color:var(--plum-soft);">${methodLabel}${o.paymentReference ? ' · Ref: '+esc(o.paymentReference) : ''}</span><br>
        ${o.creditApplied>0 ? `<span style="font-size:11px; color:var(--plum-soft);">Credit used: ${money(o.creditApplied)}</span><br>` : ''}
        ${payStatus!=='verified' && o.paymentMethod && o.paymentMethod!=='credit' ? `<button class="icon-btn" style="margin-top:4px;" onclick="verifyPayment('${o.id}')">Mark verified</button>` : ''}
      </td>
      <td>
        <select class="order-status-select" onchange="changeOrderStatus('${o.id}', this.value)">${options}</select>
      </td>
      <td>${date}</td>
      <td>
        <button class="icon-btn" onclick="openOrderDetails('${o.id}')">View details</button>
        <button class="icon-btn danger" onclick="deleteOrder('${o.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

// Shows the full order — delivery address, email, and any customer notes —
// none of which fit in the table row. Without this, the only way to see
// where to actually ship something is opening the Firebase console by hand.
let currentDetailsOrderId = null;
function openOrderDetails(id){
  const order = (window._orders||[]).find(o=>o.id===id);
  if(!order) return;
  currentDetailsOrderId = id;
  document.getElementById('orderCourier').value = order.courier || order.shippingMethod || '';
  document.getElementById('orderTrackingNumber').value = order.trackingNumber || '';
  document.getElementById('trackingMsg').innerHTML = '';
  const date = order.createdAt && order.createdAt.toDate ? order.createdAt.toDate().toLocaleString() : '—';
  const status = order.status || 'new';
  const payStatus = order.paymentStatus || (order.paymentMethod ? 'submitted' : 'unpaid');
  const payLabel = payStatus==='verified' ? 'Verified' : (payStatus==='submitted' ? 'Submitted' : 'No payment info');
  const methodLabel = order.paymentMethod === 'gcash' ? 'GCash' : (order.paymentMethod === 'bank' ? 'Bank/InstaPay' : (order.paymentMethod === 'credit' ? 'Store credit' : '—'));
  const itemsHtml = (order.items||[]).map(i=>`<li>${esc(i.qty)}× ${esc(i.name)} — ${money((i.price||0)*(i.qty||0))}</li>`).join('');
  document.getElementById('orderDetailsBody').innerHTML = `
    <div class="two-col" style="margin-bottom:14px;">
      <div><strong>Customer</strong><br>${esc(order.customerName)||'—'}</div>
      <div><strong>Phone</strong><br>${esc(order.phone)||'—'}</div>
    </div>
    <div class="two-col" style="margin-bottom:14px;">
      <div><strong>Email</strong><br>${esc(order.email)||'—'}</div>
      <div><strong>Placed</strong><br>${date}</div>
    </div>
    <div style="margin-bottom:14px;"><strong>Delivery address</strong><br>${esc(order.address)||'—'}</div>
    <div style="margin-bottom:14px;"><strong>Preferred courier (customer's choice)</strong><br>${esc(order.shippingMethod)||'—'}</div>
    <div style="margin-bottom:14px;"><strong>Order notes</strong><br>${order.notes ? esc(order.notes) : '<span style="color:var(--plum-soft);">None</span>'}</div>
    <div style="margin-bottom:14px;"><strong>Items</strong><ul style="margin:6px 0 0; padding-left:18px;">${itemsHtml}</ul></div>
    <div class="two-col" style="margin-bottom:14px;">
      <div><strong>Payment</strong><br><span class="pill pay-${payStatus}">${payLabel}</span> ${methodLabel}${order.paymentReference ? ' · Ref: '+esc(order.paymentReference) : ''}</div>
      <div><strong>Status</strong><br>${ORDER_STATUS_LABELS[status]||status}</div>
    </div>
    ${(order.subtotal!=null && (order.creditApplied>0 || order.shippingFee>0)) ? `<div style="margin-bottom:4px;"><strong>Subtotal</strong><br>${money(order.subtotal)}</div>` : ''}
    ${order.shippingFee>0 ? `<div style="margin-bottom:4px; color:var(--plum-soft);">Shipping: ${money(order.shippingFee)}</div>` : ''}
    ${order.creditApplied>0 ? `<div style="margin-bottom:4px; color:var(--plum-soft);">Store credit applied: −${money(order.creditApplied)}</div>` : ''}
    <div><strong>Total</strong><br>${money(order.total)}</div>
  `;
  document.getElementById('orderDetailsOverlay').classList.add('show');
}
document.getElementById('orderDetailsCloseBtn').addEventListener('click', ()=>{
  document.getElementById('orderDetailsOverlay').classList.remove('show');
});

// Saves courier + tracking number onto the order. If the order hasn't
// reached "shipped" yet, this also advances its status to "shipped" —
// that's the point at which a customer actually has something to track.
// It never moves a "done"/"cancelled" order backwards.
document.getElementById('saveTrackingBtn').addEventListener('click', async ()=>{
  if(!currentDetailsOrderId) return;
  const order = (window._orders||[]).find(o=>o.id===currentDetailsOrderId);
  if(!order) return;
  const courier = document.getElementById('orderCourier').value.trim();
  const trackingNumber = document.getElementById('orderTrackingNumber').value.trim();
  const msg = document.getElementById('trackingMsg');
  try{
    const data = { courier, trackingNumber };
    const alreadyPastShipped = ['shipped','done','cancelled','returned','damaged'].includes(order.status);
    const advancingToShipped = !alreadyPastShipped && (courier || trackingNumber);
    if(advancingToShipped){
      data.status = 'shipped';
      await ensureStockDeducted(order, 'Order shipped');
    }
    await db.collection('orders').doc(currentDetailsOrderId).update(data);
    msg.innerHTML = '<div class="form-msg ok">Delivery info saved.</div>';
    toast(advancingToShipped ? 'Tracking saved — order marked as shipped and stock updated' : 'Delivery info saved');
    if(advancingToShipped){
      sendOrderStatusEmail({ ...order, courier, trackingNumber }, 'Shipped');
    }
  }catch(err){
    msg.innerHTML = `<div class="form-msg err">${err.message}</div>`;
  }
});

async function verifyPayment(id){
  if(!confirm('Confirm you have checked this reference number in your GCash/bank app and the amount matches?')) return;
  try{
    await db.collection('orders').doc(id).update({
      paymentStatus:'verified', paymentVerifiedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('Payment marked as verified');
    const order = (window._orders||[]).find(o=>o.id===id);
    if(order){
      // sendOrderInvoiceEmail no-ops silently if EMAILJS_INVOICE_TEMPLATE_ID
      // is blank in firebase-config.js — in that case fall back to the
      // plain status email so the customer still hears something.
      if(EMAILJS_INVOICE_TEMPLATE_ID){
        sendOrderInvoiceEmail(order);
      }else{
        sendOrderStatusEmail(order, 'Payment verified');
      }
    }
  }catch(err){ alert(err.message); }
}

// Stock decrements happen one item at a time (adjustStock is called in a
// loop), so a failure partway through — a deleted product, a dropped
// network call — could previously leave some items decremented while the
// order's status hadn't actually changed yet. Retrying would then decrement
// the already-processed items a second time if the only guard was the
// status string itself.
//
// To make retries safe, we set a `stockDeducted: true` flag on the order as
// the very first write, before touching any product's stock. If a retry
// comes in after a partial failure, that flag is already true, so we skip
// straight past the stock loop — no item can ever be decremented twice.
//
// Stock now leaves inventory the moment an order is marked "Shipped" (not
// "Fulfilled") — that's the point the item has actually left the shelf.
// If an order somehow jumps straight to "done" without passing through
// "shipped" (e.g. a manual/offline sale entered directly as fulfilled),
// this still deducts stock at that point, guarded the same way.
// An order's `items` can include bundles (e.g. "1x Starter Set"), but a
// bundle has no stock field of its own — only its component products do.
// expandItemsForStock() (in firebase-config.js) turns that into the real
// {productId, qty} pairs whose stock actually needs to move, using each
// bundle's CURRENT contents from allProducts.
//
// We then save that expanded list onto the order as `stockDeductions`, so
// restoreStockForOrder() later reverses exactly what was actually taken —
// even if the bundle's contents get edited (or the bundle itself gets
// deleted) sometime between shipping and returning this particular order.
async function ensureStockDeducted(order, reasonPrefix){
  if(order.stockDeducted) return;
  const deductions = expandItemsForStock(order.items, allProducts);
  // Also clear stockRestored here: this order may be going through the
  // deduct → restore → re-deduct cycle again (e.g. it was cancelled and is
  // now being re-shipped), and stockRestored needs to reflect only whether
  // a restore has happened since the MOST RECENT deduction.
  await db.collection('orders').doc(order.id).update({
    stockDeducted: true, stockRestored: false,
    stockDeductions: deductions.map(d=>({productId:d.productId, qty:d.qty}))
  });
  const failed = await adjustStockBatch(
    deductions.map(d=>({productId:d.productId, qty:-Math.abs(d.qty)})),
    (item)=>{
      const src = deductions.find(d=>d.productId===item.productId);
      return src && src.bundleName ? `${reasonPrefix||'Order shipped'} — ${order.customerName||'customer'} (bundle: ${src.bundleName})` : `${reasonPrefix||'Order shipped'} — ${order.customerName||'customer'}`;
    }
  );
  if(failed.length){
    // stockDeducted is already true (by design, so retries don't double-
    // decrement the items that DID succeed) — but flag loudly that some
    // items didn't actually move, since that's no longer silent.
    toast(`⚠️ Stock wasn't updated for ${failed.length} item(s) on this order — check Inventory manually.`);
  }
}

// Reverses a prior deduction (used when an order is marked "Returned to
// seller" OR "Cancelled" after stock had already left the shelf — e.g. a
// shipped order that later gets cancelled) so the items go back into
// sellable stock. Guarded by `stockRestored` the same way
// ensureStockDeducted is guarded, so flipping the status dropdown back and
// forth never double-restocks. "Damaged" deliberately does NOT restore
// stock — those items are a write-off, not sellable inventory.
//
// Uses the `stockDeductions` snapshot saved by ensureStockDeducted (falling
// back to re-expanding order.items for older orders placed before that
// snapshot existed) so a bundle order restores the exact same components
// and quantities that were actually taken out, regardless of any bundle
// edits made since.
//
// Also clears `stockDeducted` back to false once the stock is back on the
// shelf. Without this, re-shipping/re-fulfilling the SAME order later (e.g.
// cancelled by mistake, then un-cancelled) would see stockDeducted still
// true and ensureStockDeducted would silently skip deducting stock a
// second time — even though the item is genuinely going out again.
async function restoreStockForOrder(order, reasonPrefix){
  if(!order.stockDeducted || order.stockRestored) return;
  const toRestore = (Array.isArray(order.stockDeductions) && order.stockDeductions.length)
    ? order.stockDeductions
    : expandItemsForStock(order.items, allProducts);
  await db.collection('orders').doc(order.id).update({ stockDeducted: false, stockRestored: true });
  const failed = await adjustStockBatch(
    toRestore.map(item=>({productId:item.productId, qty:Math.abs(item.qty)})),
    `${reasonPrefix||'Returned'} — ${order.customerName||'customer'}`
  );
  if(failed.length){
    toast(`⚠️ ${failed.length} item(s) from this order couldn't be added back to stock automatically — check Inventory manually.`);
  }
}

// Statuses that hand deducted stock back to inventory. "Returned" is the
// normal path; "cancelled" is included too so that cancelling an order
// *after* it already shipped (stock already left the shelf) doesn't
// silently leave inventory permanently short — see restoreStockForOrder.
// "Damaged" is deliberately NOT here — a damaged/write-off item is gone,
// not sellable, so it never goes back into stock.
const RESTOCKING_STATUSES = ['returned','cancelled'];

// Statuses that refund any store credit the customer spent on this order.
// This is a separate list from RESTOCKING_STATUSES: "damaged" doesn't put
// stock back (the item's destroyed), but the customer still didn't get a
// usable product, so whatever credit they spent on it should still come
// back to their balance.
const CREDIT_REFUND_STATUSES = ['returned','cancelled','damaged'];

// Refunds any store credit the customer spent on this order back to their
// balance. Unlike stock (which only ever leaves the shelf at ship/fulfil
// time), credit is deducted the moment the order is PLACED — so this needs
// to run on every cancel/return regardless of whether stock was ever
// deducted for the order. Guarded by `creditRestored` (mirrors
// stockRestored) so flipping the status dropdown back and forth, or a
// double-click, can never refund the same order's credit twice. No-ops
// instantly if the order never used credit in the first place.
async function restoreCreditForOrder(order, reasonPrefix){
  const amount = Number(order.creditApplied || 0);
  if(amount <= 0 || order.creditRestored) return;
  if(!order.customerUid){
    // Manual/offline sales never have store credit applied (customerUid is
    // always null for those), but guard anyway rather than assume.
    await db.collection('orders').doc(order.id).update({ creditRestored: true });
    return;
  }
  const userRef = db.collection('users').doc(order.customerUid);
  const orderRef = db.collection('orders').doc(order.id);
  await db.runTransaction(async (tx)=>{
    // Re-read both docs inside the transaction so a double-click, or a
    // second admin tab, can't refund the same order's credit twice, and so
    // the refund always lands on top of the customer's CURRENT balance
    // rather than a possibly-stale one held in the browser.
    const freshOrderDoc = await tx.get(orderRef);
    if(!freshOrderDoc.exists || freshOrderDoc.data().creditRestored) return;
    const freshUserDoc = await tx.get(userRef);
    if(freshUserDoc.exists){
      const current = Number(freshUserDoc.data().creditBalance || 0);
      tx.update(userRef, { creditBalance: current + amount });
    }
    tx.update(orderRef, { creditRestored: true });
  });
  toast(`${money(amount)} store credit refunded to ${order.customerName || 'the customer'}`);
}

// Handles any status change from the dropdown.
async function changeOrderStatus(id, newStatus){
  const order = (window._orders||[]).find(o=>o.id===id);
  if(!order) return;
  const willDeductNow = STOCK_DEDUCTING_STATUSES.includes(newStatus) && !order.stockDeducted;
  if(willDeductNow && order.paymentStatus !== 'verified'){
    const label = newStatus==='shipped' ? 'shipped' : 'fulfilled';
    if(!confirm(`Payment for this order has not been marked verified yet. Mark it ${label} anyway?`)) return;
  }
  const willRestoreCredit = CREDIT_REFUND_STATUSES.includes(newStatus) && Number(order.creditApplied||0) > 0 && !order.creditRestored;
  if(RESTOCKING_STATUSES.includes(newStatus) && order.stockDeducted && !order.stockRestored){
    const creditNote = willRestoreCredit ? ` and ${money(order.creditApplied)} in store credit refunded to the customer` : '';
    if(!confirm(`This will add the order's items back to stock${creditNote}, since they were already deducted. Mark it as ${ORDER_STATUS_LABELS[newStatus].toLowerCase()} anyway?`)) return;
  } else if(newStatus === 'returned' && !order.stockDeducted){
    const creditNote = willRestoreCredit ? ` (${money(order.creditApplied)} in store credit will still be refunded to the customer)` : '';
    if(!confirm(`This order was never marked as shipped/fulfilled, so there is no stock to bring back${creditNote}. Mark it as returned anyway?`)) return;
  } else if(willRestoreCredit){
    if(!confirm(`This order used ${money(order.creditApplied)} in store credit — it will be refunded to the customer's balance. Mark it as ${ORDER_STATUS_LABELS[newStatus].toLowerCase()} anyway?`)) return;
  }
  try{
    if(STOCK_DEDUCTING_STATUSES.includes(newStatus)){
      await ensureStockDeducted(order, newStatus==='shipped' ? 'Order shipped' : 'Order fulfilled');
    }
    if(RESTOCKING_STATUSES.includes(newStatus)){
      await restoreStockForOrder(order, newStatus==='returned' ? 'Returned to seller' : 'Order cancelled');
    }
    if(CREDIT_REFUND_STATUSES.includes(newStatus)){
      const creditReason = newStatus==='returned' ? 'Returned to seller' : (newStatus==='cancelled' ? 'Order cancelled' : 'Marked damaged / write-off');
      await restoreCreditForOrder(order, creditReason);
    }
    const updateData = { status:newStatus };
    if(newStatus === 'done') updateData.fulfilledAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('orders').doc(id).update(updateData);
    toast(`Order status set to ${ORDER_STATUS_LABELS[newStatus]}`);
    if(newStatus === 'shipped' || newStatus === 'done'){
      sendOrderStatusEmail(order, ORDER_STATUS_LABELS[newStatus]);
    }
    if(newStatus === 'done'){
      await processReferralReward({ ...order, id, status:'done' });
    }
  }catch(err){ alert(err.message); }
}

// ============================================================
// REFERRALS
// ============================================================
// Rewards the person who referred this order's customer — but only once,
// the first time that referred customer has any order marked Fulfilled.
// Guarded by the referral doc's own status ('pending' -> 'rewarded'), so
// re-fulfilling, editing, or re-triggering this never pays out twice.
async function processReferralReward(order){
  if(!order.customerUid) return;
  try{
    const refSnap = await db.collection('referrals')
      .where('referredUid','==',order.customerUid)
      .where('status','==','pending')
      .limit(1).get();
    if(refSnap.empty) return;
    const refDoc = refSnap.docs[0];
    const referral = refDoc.data();
    const referrerRef = db.collection('users').doc(referral.referrerUid);
    const referrerDoc = await referrerRef.get();
    if(!referrerDoc.exists) return; // referrer account no longer exists — nothing to credit

    // Referral links only unlock in the UI after a customer's own first
    // fulfilled order — but the link itself is just their uid, so someone
    // could still hand it out manually before that. Enforce the same rule
    // here so an account with no purchase history can never actually be
    // credited, regardless of how the link was shared.
    const referrerOrdersSnap = await db.collection('orders').where('customerUid','==',referral.referrerUid).get();
    const referrerHasPurchaseHistory = referrerOrdersSnap.docs.some(d=>d.data().status==='done');
    if(!referrerHasPurchaseHistory) return;

    const settingsDoc = await db.collection('settings').doc('site').get();
    const settingsData = settingsDoc.exists ? settingsDoc.data() : {};
    if(settingsData.referralEnabled === false) return; // program turned off
    const rewardAmount = Number(settingsData.referralRewardAmount || 0);
    if(rewardAmount <= 0) return; // admin hasn't set a reward amount

    let rewardGiven = false;
    await db.runTransaction(async (tx)=>{
      // Re-read the referral doc INSIDE the transaction and re-check its
      // status here. The status check further up (from the query) happens
      // before this transaction starts, so if two orders for the same
      // referred customer were marked "Fulfilled" moments apart, both calls
      // could pass that earlier check before either one commits. Re-reading
      // and re-verifying status=='pending' inside the transaction closes
      // that gap — only the first one to commit can ever flip it to
      // 'rewarded', so the referrer can never be credited twice.
      const freshRefDoc = await tx.get(refDoc.ref);
      if(!freshRefDoc.exists || freshRefDoc.data().status !== 'pending') return;

      const freshReferrer = await tx.get(referrerRef);
      const current = freshReferrer.exists ? Number(freshReferrer.data().creditBalance || 0) : 0;
      tx.update(referrerRef, { creditBalance: current + rewardAmount });
      tx.update(refDoc.ref, {
        status: 'rewarded',
        rewardAmount,
        orderId: order.id,
        rewardedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      rewardGiven = true;
    });
    if(rewardGiven){
      toast(`Referral reward: ${money(rewardAmount)} credited to ${referrerDoc.data().name || referrerDoc.data().email || 'referrer'}`);
    }
  }catch(err){ console.error('Could not process referral reward', err); }
}

let allReferrals = [];
function listenReferrals(){
  db.collection('referrals').orderBy('createdAt','desc').onSnapshot(snap=>{
    allReferrals = [];
    snap.forEach(doc=> allReferrals.push({id:doc.id, ...doc.data()}));
    renderReferrals();
  }, err=>console.error(err));
}
function renderReferrals(){
  const body = document.getElementById('adminReferralBody');
  const statRow = document.getElementById('referralStatRow');
  if(!body) return;
  const pending = allReferrals.filter(r=>r.status==='pending').length;
  const rewarded = allReferrals.filter(r=>r.status==='rewarded');
  const totalPaid = rewarded.reduce((s,r)=>s+Number(r.rewardAmount||0),0);
  if(statRow){
    statRow.innerHTML = `
      <div class="stat-card"><div class="num">${allReferrals.length}</div><div class="label">Total referrals</div></div>
      <div class="stat-card"><div class="num">${pending}</div><div class="label">Awaiting first purchase</div></div>
      <div class="stat-card"><div class="num">${rewarded.length}</div><div class="label">Rewarded</div></div>
      <div class="stat-card"><div class="num">${money(totalPaid)}</div><div class="label">Total credit issued</div></div>
    `;
  }
  if(allReferrals.length===0){
    body.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--plum-soft); padding:40px;">No referrals yet.</td></tr>`;
    return;
  }
  const usersById = {};
  allUsers.forEach(u=> usersById[u.id] = u);
  body.innerHTML = allReferrals.map(r=>{
    const referrer = usersById[r.referrerUid];
    const referrerLabel = referrer ? (referrer.name || referrer.email) : r.referrerUid;
    const date = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleDateString() : '—';
    const statusClass = r.status==='rewarded' ? 'status-done' : 'status-new';
    const statusLabel = r.status==='rewarded' ? 'Rewarded' : 'Awaiting purchase';
    return `
    <tr>
      <td>${esc(referrerLabel)||'—'}</td>
      <td>${esc(r.referredName)||esc(r.referredEmail)||'—'}</td>
      <td><span class="pill ${statusClass}">${statusLabel}</span></td>
      <td>${r.rewardAmount ? money(r.rewardAmount) : '—'}</td>
      <td>${date}</td>
    </tr>`;
  }).join('');
  renderCreditBalances();
}
function renderCreditBalances(){
  const body = document.getElementById('adminCreditBody');
  if(!body) return;
  const withCredit = allUsers.filter(u=>Number(u.creditBalance||0) > 0);
  if(withCredit.length===0){
    body.innerHTML = `<tr><td colspan="2" style="text-align:center; color:var(--plum-soft); padding:30px;">No customers currently hold store credit.</td></tr>`;
    return;
  }
  body.innerHTML = withCredit.map(u=>`
    <tr>
      <td><strong>${esc(u.name)||'—'}</strong><br><span style="color:var(--plum-soft); font-size:12px;">${esc(u.email)}</span></td>
      <td>${money(u.creditBalance)}</td>
    </tr>`).join('');
}

// Deletes an order/sale record entirely — e.g. a duplicate, a mistake, or a
// sale that needs to disappear from the books. If stock had already been
// deducted for it and never restored, that stock is put back first so
// deleting a sale never silently leaves inventory permanently short.
async function deleteOrder(id){
  const order = (window._orders||[]).find(o=>o.id===id);
  if(!order) return;
  const willRestock = order.stockDeducted && !order.stockRestored;
  const willRefundCredit = Number(order.creditApplied||0) > 0 && !order.creditRestored;
  let msg = 'Delete this order? This cannot be undone.';
  if(willRestock && willRefundCredit){
    msg = `Delete this order? Its items will be added back to stock and ${money(order.creditApplied)} in store credit will be refunded to the customer, since neither had been reversed yet. This cannot be undone.`;
  } else if(willRestock){
    msg = 'Delete this order? Its items will be added back to stock since they were already deducted. This cannot be undone.';
  } else if(willRefundCredit){
    msg = `Delete this order? ${money(order.creditApplied)} in store credit will be refunded to the customer, since it hadn't been reversed yet. This cannot be undone.`;
  }
  if(!confirm(msg)) return;
  try{
    if(willRestock){
      // Use the same expanded/snapshotted component list restoreStockForOrder
      // uses — for a bundle order this is the real products inside it, not
      // the bundle's own id (which has no stock field to restore).
      const toRestore = (Array.isArray(order.stockDeductions) && order.stockDeductions.length)
        ? order.stockDeductions
        : expandItemsForStock(order.items, allProducts);
      const failed = await adjustStockBatch(
        toRestore.map(item=>({productId:item.productId, qty:Math.abs(item.qty)})),
        `Order deleted — ${order.customerName||'customer'}`
      );
      if(failed.length){
        toast(`⚠️ ${failed.length} item(s) couldn't be added back to stock — check Inventory manually.`);
      }
    }
    if(willRefundCredit){
      await restoreCreditForOrder(order, 'Order deleted');
    }
    await db.collection('orders').doc(id).delete();
    toast('Order deleted');
  }catch(err){ alert(err.message); }
}

// ============================================================
// SALES DASHBOARD
// ============================================================
function renderSalesDashboard(){
  const salesRow = document.getElementById('salesStatRow');
  if(!salesRow) return;
  const orders = (window._orders||[]).filter(o=>o.status==='done');
  const returnedCount = (window._orders||[]).filter(o=>o.status==='returned').length;
  const damagedCount = (window._orders||[]).filter(o=>o.status==='damaged').length;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate()-startOfToday.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  function within(o, start){
    const d = o.fulfilledAt && o.fulfilledAt.toDate ? o.fulfilledAt.toDate() : (o.createdAt && o.createdAt.toDate ? o.createdAt.toDate() : null);
    return d && d >= start;
  }
  // Cost of an order: sum of each item's snapshotted costPrice × qty. Orders
  // placed before cost tracking existed (or items missing a costPrice) count
  // as 0 cost for that item, so profit falls back to showing full revenue
  // for those rather than guessing.
  function orderCost(o){
    return (o.items||[]).reduce((s,i)=>s+Number(i.costPrice||0)*Number(i.qty||0),0);
  }
  function orderProfit(o){
    return Number(o.total||0) - orderCost(o);
  }

  const revToday = orders.filter(o=>within(o,startOfToday)).reduce((s,o)=>s+Number(o.total||0),0);
  const revWeek = orders.filter(o=>within(o,startOfWeek)).reduce((s,o)=>s+Number(o.total||0),0);
  const revMonth = orders.filter(o=>within(o,startOfMonth)).reduce((s,o)=>s+Number(o.total||0),0);
  const revAll = orders.reduce((s,o)=>s+Number(o.total||0),0);
  const avgOrder = orders.length ? revAll/orders.length : 0;
  const costAll = orders.reduce((s,o)=>s+orderCost(o),0);
  const profitAll = revAll - costAll;
  const marginAll = revAll>0 ? (profitAll/revAll*100) : 0;
  const profitMonth = orders.filter(o=>within(o,startOfMonth)).reduce((s,o)=>s+orderProfit(o),0);

  salesRow.innerHTML = `
    <div class="stat-card"><div class="num">${money(revToday)}</div><div class="label">Revenue today</div></div>
    <div class="stat-card"><div class="num">${money(revWeek)}</div><div class="label">This week</div></div>
    <div class="stat-card"><div class="num">${money(revMonth)}</div><div class="label">This month</div></div>
    <div class="stat-card"><div class="num">${money(revAll)}</div><div class="label">All-time revenue</div></div>
    <div class="stat-card"><div class="num">${orders.length}</div><div class="label">Fulfilled orders</div></div>
    <div class="stat-card"><div class="num">${money(avgOrder)}</div><div class="label">Avg. order value</div></div>
    <div class="stat-card"><div class="num">${money(costAll)}</div><div class="label">All-time cost of goods</div></div>
    <div class="stat-card"><div class="num">${money(profitMonth)}</div><div class="label">Profit this month</div></div>
    <div class="stat-card"><div class="num">${money(profitAll)}</div><div class="label">All-time profit</div></div>
    <div class="stat-card"><div class="num">${marginAll.toFixed(1)}%</div><div class="label">Overall margin</div></div>
    <div class="stat-card"><div class="num">${returnedCount}</div><div class="label">Returned to seller</div></div>
    <div class="stat-card"><div class="num">${damagedCount}</div><div class="label">Damaged / write-off</div></div>
  `;

  const body = document.getElementById('adminSalesBody');
  if(orders.length===0){
    body.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--plum-soft); padding:40px;">No completed sales yet.</td></tr>`;
  } else {
    body.innerHTML = orders.slice(0,30).map(o=>{
      const itemSummary = (o.items||[]).map(i=>`${esc(i.qty)}× ${esc(i.name)}`).join(', ');
      const date = o.fulfilledAt && o.fulfilledAt.toDate ? o.fulfilledAt.toDate().toLocaleDateString() : '—';
      const cost = orderCost(o);
      const profit = orderProfit(o);
      const manualBadge = o.source==='manual' ? ' <span class="pill source-manual">Manual</span>' : '';
      return `
      <tr>
        <td><strong>${esc(o.customerName)||'—'}</strong>${manualBadge}</td>
        <td style="max-width:220px;">${itemSummary}</td>
        <td>${money(o.total)}</td>
        <td>${money(cost)}</td>
        <td>${money(profit)}</td>
        <td>${date}</td>
        <td><button class="icon-btn danger" onclick="deleteOrder('${o.id}')">Delete</button></td>
      </tr>`;
    }).join('');
  }

  const tally = {};
  orders.forEach(o=>{
    (o.items||[]).forEach(i=>{
      tally[i.name] = (tally[i.name]||0) + Number(i.qty||0);
    });
  });
  const ranked = Object.entries(tally).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const maxQty = ranked.length ? ranked[0][1] : 1;
  const list = document.getElementById('topSellersList');
  if(ranked.length===0){
    list.innerHTML = `<p style="color:var(--plum-soft); font-size:13px;">No sales data yet.</p>`;
  } else {
    list.innerHTML = ranked.map(([name,qty])=>`
      <div class="seller-row">
        <div class="seller-row-top"><span>${esc(name)}</span><strong>${qty} sold</strong></div>
        <div class="seller-bar-track"><div class="seller-bar-fill" style="width:${(qty/maxQty*100).toFixed(0)}%"></div></div>
      </div>
    `).join('');
  }
}

// ============================================================
// MANUAL SALES (offline / off-site sales, entered by hand so revenue
// and stock levels reflect sales that didn't happen through the site —
// e.g. a Messenger order, a marketplace sale, or an in-person sale).
// These are written as normal "done" orders with source:'manual' so
// they show up in Sales, Orders, and inventory just like any other
// completed sale, tagged with a "Manual sale" badge.
// ============================================================
let manualSaleItems = [];

function openManualSaleModal(){
  manualSaleItems = [];
  document.getElementById('manualSaleCustomer').value = '';
  document.getElementById('manualSaleNotes').value = '';
  document.getElementById('manualSaleMsg').innerHTML = '';
  addManualSaleItemRow();
  document.getElementById('manualSaleModalOverlay').classList.add('show');
}
const addManualSaleBtn = document.getElementById('addManualSaleBtn');
if(addManualSaleBtn) addManualSaleBtn.addEventListener('click', openManualSaleModal);
const manualSaleCloseBtn = document.getElementById('manualSaleCloseBtn');
if(manualSaleCloseBtn) manualSaleCloseBtn.addEventListener('click', ()=>{
  document.getElementById('manualSaleModalOverlay').classList.remove('show');
});

// Manual sales (offline/off-site) only pick from real, single-stock
// products — not bundles. A bundle has no stock field of its own to
// adjust, so selling one here would need the same component-expansion
// logic as an online checkout; for now, record a bundle's offline sale as
// its individual component products instead.
function manualSaleCandidates(){
  return allProducts.filter(p=>!p.isBundle);
}
function addManualSaleItemRow(){
  const firstProduct = manualSaleCandidates()[0];
  manualSaleItems.push({
    productId: firstProduct ? firstProduct.id : '',
    qty: 1,
    price: firstProduct ? Number(firstProduct.price||0) : 0
  });
  renderManualSaleItems();
}
function removeManualSaleItemRow(i){
  manualSaleItems.splice(i,1);
  renderManualSaleItems();
}
function renderManualSaleItems(){
  const wrap = document.getElementById('manualSaleItemList');
  if(!wrap) return;
  const candidates = manualSaleCandidates();
  if(candidates.length===0){
    wrap.innerHTML = `<p style="color:var(--plum-soft); font-size:13px;">Add a product first — there's nothing to sell yet.</p>`;
    return;
  }
  if(manualSaleItems.length===0){
    wrap.innerHTML = `<p style="color:var(--plum-soft); font-size:13px;">No items yet — add one below.</p>`;
  } else {
    wrap.innerHTML = manualSaleItems.map((it,i)=>{
      const options = candidates.map(p=>`<option value="${p.id}" ${p.id===it.productId?'selected':''}>${esc(p.name)||'Untitled'}</option>`).join('');
      return `
      <div class="repeat-row">
        <div class="field" style="flex:2;"><label>Product</label><select class="man-item-product" data-i="${i}">${options}</select></div>
        <div class="field" style="max-width:90px;"><label>Qty</label><input type="number" min="1" class="man-item-qty" data-i="${i}" value="${it.qty}"></div>
        <div class="field" style="max-width:130px;"><label>Price each</label><input type="number" min="0" step="0.01" class="man-item-price" data-i="${i}" value="${it.price}"></div>
        <button type="button" class="remove-row-btn" onclick="removeManualSaleItemRow(${i})">Remove</button>
      </div>`;
    }).join('');
  }
  wrap.querySelectorAll('.man-item-product').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      const i = Number(sel.dataset.i);
      manualSaleItems[i].productId = sel.value;
      const p = allProducts.find(x=>x.id===sel.value);
      if(p) manualSaleItems[i].price = Number(p.price||0);
      renderManualSaleItems();
    });
  });
  wrap.querySelectorAll('.man-item-qty').forEach(inp=>{
    inp.addEventListener('input', ()=>{ manualSaleItems[Number(inp.dataset.i)].qty = parseInt(inp.value)||1; updateManualSaleTotal(); });
  });
  wrap.querySelectorAll('.man-item-price').forEach(inp=>{
    inp.addEventListener('input', ()=>{ manualSaleItems[Number(inp.dataset.i)].price = parseFloat(inp.value)||0; updateManualSaleTotal(); });
  });
  updateManualSaleTotal();
}
function updateManualSaleTotal(){
  const total = manualSaleItems.reduce((s,it)=>s+Number(it.price||0)*Number(it.qty||0),0);
  const totalEl = document.getElementById('manualSaleTotal');
  if(totalEl) totalEl.textContent = money(total);
}
const addManualSaleItemBtn = document.getElementById('addManualSaleItemBtn');
if(addManualSaleItemBtn) addManualSaleItemBtn.addEventListener('click', addManualSaleItemRow);

const saveManualSaleBtn = document.getElementById('saveManualSaleBtn');
if(saveManualSaleBtn) saveManualSaleBtn.addEventListener('click', async ()=>{
  const msg = document.getElementById('manualSaleMsg');
  const customerName = document.getElementById('manualSaleCustomer').value.trim() || 'Walk-in / manual sale';
  const notes = document.getElementById('manualSaleNotes').value.trim();
  const validItems = manualSaleItems.filter(it=>it.productId && Number(it.qty)>0);
  if(validItems.length===0){
    msg.innerHTML = '<div class="form-msg err">Add at least one item with a quantity.</div>';
    return;
  }
  // Same product can be picked more than once across rows — combine
  // quantities per product before checking against current stock, so two
  // rows of the same item can't each pass a per-row check while together
  // overselling it.
  const qtyByProduct = {};
  validItems.forEach(it=>{ qtyByProduct[it.productId] = (qtyByProduct[it.productId]||0) + Number(it.qty); });
  for(const productId of Object.keys(qtyByProduct)){
    const p = allProducts.find(x=>x.id===productId);
    if(!p){
      msg.innerHTML = '<div class="form-msg err">One of the selected products no longer exists — please remove it.</div>';
      return;
    }
    const available = Number(p.stock||0);
    if(qtyByProduct[productId] > available){
      msg.innerHTML = `<div class="form-msg err">Only ${available} of "${esc(p.name)}" in stock — please adjust the quantity.</div>`;
      return;
    }
  }
  const items = validItems.map(it=>{
    const p = allProducts.find(x=>x.id===it.productId);
    return { productId: it.productId, name: p ? p.name : 'Unknown item', price: Number(it.price||0), costPrice: p ? Number(p.costPrice||0) : 0, qty: Number(it.qty) };
  });
  const total = items.reduce((s,i)=>s+i.price*i.qty,0);
  saveManualSaleBtn.disabled = true; saveManualSaleBtn.textContent = 'Saving...';
  try{
    await db.collection('orders').add({
      customerName, email:'', phone:'', address:'', notes, items, total,
      customerUid: null,
      paymentMethod: 'manual', paymentReference: '', paymentStatus: 'verified',
      source: 'manual',
      status: 'done', stockDeducted: true,
      // FIX: snapshot the exact {productId, qty} pairs that were deducted,
      // same as ensureStockDeducted() does for online orders. Without this,
      // restoreStockForOrder()/deleteOrder() fell back to re-expanding
      // order.items live — which is harmless today (manual sales can't
      // contain bundles) but silently breaks the moment bundles are ever
      // allowed here, or if a product's identity changes before a refund.
      stockDeductions: items.map(i=>({productId:i.productId, qty:i.qty})),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      fulfilledAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    for(const item of items){
      await adjustStock(item.productId, -Math.abs(item.qty), `Manual sale entry — ${customerName}`);
    }
    toast('Manual sale recorded');
    document.getElementById('manualSaleModalOverlay').classList.remove('show');
  }catch(err){
    msg.innerHTML = `<div class="form-msg err">${err.message}</div>`;
  }
  saveManualSaleBtn.disabled = false; saveManualSaleBtn.textContent = 'Save sale';
});

// ============================================================
// SETTINGS
// ============================================================
let marqueeMessages = [];
let testimonials = [];

function renderMarqueeList(){
  const wrap = document.getElementById('marqueeList');
  if(marqueeMessages.length===0){
    wrap.innerHTML = `<p style="color:var(--plum-soft); font-size:13px;">No messages yet — add one below.</p>`;
  } else {
    wrap.innerHTML = marqueeMessages.map((msg,i)=>`
      <div class="repeat-row">
        <div class="field"><label>Message ${i+1}</label><input type="text" class="marquee-input" data-i="${i}" value="${esc(msg)}"></div>
        <button type="button" class="remove-row-btn" onclick="removeMarqueeMsg(${i})">Remove</button>
      </div>`).join('');
  }
  wrap.querySelectorAll('.marquee-input').forEach(inp=>{
    inp.addEventListener('input', ()=>{ marqueeMessages[Number(inp.dataset.i)] = inp.value; });
  });
}
function removeMarqueeMsg(i){ marqueeMessages.splice(i,1); renderMarqueeList(); }
document.getElementById('addMarqueeBtn').addEventListener('click', ()=>{
  marqueeMessages.push('');
  renderMarqueeList();
});

function renderTestimonialList(){
  const wrap = document.getElementById('testimonialList');
  if(testimonials.length===0){
    wrap.innerHTML = `<p style="color:var(--plum-soft); font-size:13px;">No testimonials yet — add one below.</p>`;
  } else {
    wrap.innerHTML = testimonials.map((t,i)=>`
      <div class="repeat-row" style="flex-wrap:wrap;">
        <div class="field" style="min-width:140px;"><label>Name</label><input type="text" class="test-name" data-i="${i}" value="${esc(t.name)}"></div>
        <div class="field" style="min-width:140px;"><label>Meta (e.g. "Verified order")</label><input type="text" class="test-meta" data-i="${i}" value="${esc(t.meta)}"></div>
        <div class="field" style="flex-basis:100%;"><label>Quote</label><textarea class="test-quote" data-i="${i}">${esc(t.quote)}</textarea></div>
        <button type="button" class="remove-row-btn" onclick="removeTestimonial(${i})">Remove</button>
      </div>`).join('');
  }
  wrap.querySelectorAll('.test-name').forEach(inp=>inp.addEventListener('input', ()=>{ testimonials[Number(inp.dataset.i)].name = inp.value; }));
  wrap.querySelectorAll('.test-meta').forEach(inp=>inp.addEventListener('input', ()=>{ testimonials[Number(inp.dataset.i)].meta = inp.value; }));
  wrap.querySelectorAll('.test-quote').forEach(inp=>inp.addEventListener('input', ()=>{ testimonials[Number(inp.dataset.i)].quote = inp.value; }));
}
function removeTestimonial(i){ testimonials.splice(i,1); renderTestimonialList(); }
document.getElementById('addTestimonialBtn').addEventListener('click', ()=>{
  testimonials.push({name:'', meta:'Verified order', quote:''});
  renderTestimonialList();
});

async function loadSettingsIntoForm(){
  try{
    const doc = await db.collection('settings').doc('site').get();
    const s = doc.exists ? doc.data() : {};
    document.getElementById('setStoreName').value = s.storeName || 'Bloomé by KJ';
    document.getElementById('setContactEmail').value = s.contactEmail || 'hello@bloomebykj.co';
    document.getElementById('setResponseTime').value = s.responseTime || 'Usually within a day';
    document.getElementById('setFooterTagline').value = s.footerTagline || 'A small, careful shop for peptide-based skincare. Built with honesty about ingredients and stock.';
    document.getElementById('setHeroLine1').value = s.heroLine1 || 'Skin biology,';
    document.getElementById('setHeroLine2').value = s.heroLine2 || 'refined';
    document.getElementById('setHeroLede').value = s.heroLede || "Peptide-driven formulas built around ingredients like GHK-Cu, sourced carefully and presented plainly — so you know exactly what you're getting.";
    document.getElementById('setGcashName').value = s.gcashName || '';
    document.getElementById('setGcashNumber').value = s.gcashNumber || '';
    document.getElementById('setBankName').value = s.bankName || '';
    document.getElementById('setBankAccountName').value = s.bankAccountName || '';
    document.getElementById('setBankAccountNumber').value = s.bankAccountNumber || '';
    document.getElementById('setPopupEnabled').value = s.popupEnabled ? 'true' : 'false';
    document.getElementById('setPopupHeading').value = s.popupHeading || '';
    document.getElementById('setPopupButtonLabel').value = s.popupButtonLabel || '';
    document.getElementById('setPopupButtonLink').value = s.popupButtonLink || '';
    document.getElementById('setPopupFrequency').value = s.popupFrequency || 'session';
    document.getElementById('setTawkPropertyId').value = s.tawkPropertyId || '';
    document.getElementById('setTawkWidgetId').value = s.tawkWidgetId || '';
    document.getElementById('setReferralReward').value = s.referralRewardAmount != null ? s.referralRewardAmount : 100;
    document.getElementById('setReferralEnabled').value = s.referralEnabled === false ? 'false' : 'true';
    document.getElementById('setShippingFee').value = s.shippingFee != null ? s.shippingFee : 0;
    document.getElementById('setShippingFeeEnabled').value = s.shippingFeeEnabled ? 'true' : 'false';
    wireImageUpload({ fileInputId:'setHeroImageFile', previewId:'setHeroImagePreview', urlFieldId:'setHeroImage', progressId:'setHeroImageProgress', folder:'settings', existingUrl: s.heroImage||'' });
    wireImageUpload({ fileInputId:'setAboutImageFile', previewId:'setAboutImagePreview', urlFieldId:'setAboutImage', progressId:'setAboutImageProgress', folder:'settings', existingUrl: s.aboutImage||'' });
    wireImageUpload({ fileInputId:'setGcashQRFile', previewId:'setGcashQRPreview', urlFieldId:'setGcashQR', progressId:'setGcashQRProgress', folder:'settings', existingUrl: s.gcashQR||'' });
    wireImageUpload({ fileInputId:'setBankQRFile', previewId:'setBankQRPreview', urlFieldId:'setBankQR', progressId:'setBankQRProgress', folder:'settings', existingUrl: s.bankQR||'' });
    wireImageUpload({ fileInputId:'setPopupImageFile', previewId:'setPopupImagePreview', urlFieldId:'setPopupImage', progressId:'setPopupImageProgress', folder:'settings', existingUrl: s.popupImage||'' });
    marqueeMessages = Array.isArray(s.marqueeMessages) && s.marqueeMessages.length ? s.marqueeMessages.slice() : [
      'Free shipping on orders over ₱3,000',
      'Same-day dispatch on weekday orders before 3PM',
      'New batch restocked weekly'
    ];
    testimonials = Array.isArray(s.testimonials) && s.testimonials.length ? s.testimonials.slice() : [
      {name:'M. Cruz', meta:'Verified order', quote:'Ordering was straightforward and the stock count was accurate — what I saw online was what actually arrived.'},
      {name:'R. Santos', meta:'Verified order', quote:'Appreciated the plain, factual listings instead of exaggerated claims. Made the choice a lot easier.'},
      {name:'J. Dela Cruz', meta:'Verified order', quote:'Quick replies whenever I had a question before ordering. Felt like an actual person on the other end.'}
    ];
    renderMarqueeList();
    renderTestimonialList();
  }catch(err){ console.error(err); }
}
document.getElementById('saveSettingsBtn').addEventListener('click', async ()=>{
  const uploadingIds = ['setHeroImageProgress','setAboutImageProgress','setGcashQRProgress','setBankQRProgress','setPopupImageProgress'];
  for(const id of uploadingIds){
    const el = document.getElementById(id);
    if(el && el.style.display!=='none' && el.textContent.startsWith('Uploading')){
      document.getElementById('settingsMsg').innerHTML = '<div class="form-msg err">Please wait for images to finish uploading.</div>';
      return;
    }
  }
  const data = {
    storeName: document.getElementById('setStoreName').value.trim(),
    contactEmail: document.getElementById('setContactEmail').value.trim(),
    responseTime: document.getElementById('setResponseTime').value.trim(),
    footerTagline: document.getElementById('setFooterTagline').value.trim(),
    heroLine1: document.getElementById('setHeroLine1').value.trim(),
    heroLine2: document.getElementById('setHeroLine2').value.trim(),
    heroLede: document.getElementById('setHeroLede').value.trim(),
    heroImage: document.getElementById('setHeroImage').value.trim(),
    aboutImage: document.getElementById('setAboutImage').value.trim(),
    gcashName: document.getElementById('setGcashName').value.trim(),
    gcashNumber: document.getElementById('setGcashNumber').value.trim(),
    gcashQR: document.getElementById('setGcashQR').value.trim(),
    bankName: document.getElementById('setBankName').value.trim(),
    bankAccountName: document.getElementById('setBankAccountName').value.trim(),
    bankAccountNumber: document.getElementById('setBankAccountNumber').value.trim(),
    bankQR: document.getElementById('setBankQR').value.trim(),
    marqueeMessages: marqueeMessages.map(m=>m.trim()).filter(Boolean),
    testimonials: testimonials.filter(t=>t.name.trim() && t.quote.trim()),
    popupEnabled: document.getElementById('setPopupEnabled').value === 'true',
    popupImage: document.getElementById('setPopupImage').value.trim(),
    popupHeading: document.getElementById('setPopupHeading').value.trim(),
    popupButtonLabel: document.getElementById('setPopupButtonLabel').value.trim(),
    popupButtonLink: document.getElementById('setPopupButtonLink').value.trim(),
    popupFrequency: document.getElementById('setPopupFrequency').value,
    tawkPropertyId: document.getElementById('setTawkPropertyId').value.trim(),
    tawkWidgetId: document.getElementById('setTawkWidgetId').value.trim(),
    referralRewardAmount: parseFloat(document.getElementById('setReferralReward').value) || 0,
    referralEnabled: document.getElementById('setReferralEnabled').value === 'true',
    shippingFee: Math.max(0, parseFloat(document.getElementById('setShippingFee').value) || 0),
    shippingFeeEnabled: document.getElementById('setShippingFeeEnabled').value === 'true',
  };
  try{
    await db.collection('settings').doc('site').set(data, {merge:true});
    document.getElementById('settingsMsg').innerHTML = '<div class="form-msg ok">Saved — index.html picks these up automatically on next load.</div>';
  }catch(err){
    document.getElementById('settingsMsg').innerHTML = `<div class="form-msg err">${err.message}</div>`;
  }
});

// ============================================================
// USERS
// ============================================================
let allUsers = [];
function listenUsers(){
  db.collection('users').orderBy('createdAt','desc').onSnapshot(snap=>{
    allUsers = [];
    snap.forEach(doc=> allUsers.push({id:doc.id, ...doc.data()}));
    renderUsers();
    renderCreditBalances();
  }, err=>console.error(err));
}
function renderUsers(){
  const body = document.getElementById('adminUserBody');
  if(!body) return;
  if(allUsers.length===0){
    body.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--plum-soft); padding:40px;">No users yet.</td></tr>`;
    return;
  }
  const myUid = auth.currentUser ? auth.currentUser.uid : null;
  body.innerHTML = allUsers.map(u=>{
    const role = u.role || 'customer';
    const initial = (u.name || u.email || '?').charAt(0).toUpperCase();
    const date = u.createdAt && u.createdAt.toDate ? u.createdAt.toDate().toLocaleDateString() : '—';
    const isSelf = u.id === myUid;
    return `
    <tr>
      <td><span class="user-avatar-sm">${esc(initial)}</span><strong>${esc(u.name) || '—'}</strong><br><span style="color:var(--plum-soft); font-size:12px;">${esc(u.email)}</span></td>
      <td><span class="pill role-${role}">${role}</span></td>
      <td>${date}</td>
      <td>
        ${isSelf
          ? '<span style="color:var(--plum-soft); font-size:12px;">This is you</span>'
          : (role === 'admin'
            ? `<button class="icon-btn danger" onclick="demoteUser('${u.id}')">Demote to customer</button>`
            : `<button class="icon-btn" onclick="promoteUser('${u.id}')">Promote to admin</button>`)}
      </td>
    </tr>`;
  }).join('');
}
async function promoteUser(uid){
  if(!confirm('Give this account full admin access to the store?')) return;
  try{ await db.collection('users').doc(uid).update({role:'admin'}); toast('Account promoted to admin'); }
  catch(err){ alert(err.message); }
}
async function demoteUser(uid){
  if(!confirm('Remove admin access from this account?')) return;
  try{ await db.collection('users').doc(uid).update({role:'customer'}); toast('Account moved back to customer'); }
  catch(err){ alert(err.message); }
}