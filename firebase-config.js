// =====================================================================
// SHARED FIREBASE SETUP — used by login.html, shop.html, admin.html
// =====================================================================
// Replace the values below with YOUR Firebase project's config
// (Project settings -> General -> Your apps -> SDK setup and configuration).
const firebaseConfig = {
  apiKey: "AIzaSyCojE3jbs7Oo90s5k_kxFdcj1Jc0IWBfV0",
  authDomain: "bloome-by-kj.firebaseapp.com",
  projectId: "bloome-by-kj",
  storageBucket: "bloome-by-kj.firebasestorage.app",
  messagingSenderId: "778901272194",
  appId: "1:778901272194:web:8cd05cb8d67f6f4185e69b"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const storage = firebase.storage();

// ---------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------
function money(n){
  return '₱' + Number(n||0).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2});
}

// Placeholder shown wherever a product/settings image hasn't been set yet.
// Using this instead of an empty src="" avoids the browser treating a blank
// src as "reload the current page" and showing a broken-image icon.
const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1556228720-195a672e8a03?q=80&w=800&auto=format&fit=crop';
function productImg(url){
  return esc(url) || PLACEHOLDER_IMAGE;
}

// ---------------------------------------------------------------------
// BUNDLES ("packages" of multiple products sold as one item)
// A bundle product looks like any other product doc (name, price, image,
// category...) plus:
//   isBundle: true
//   bundleItems: [{ productId, name, qty }, ...]   // qty = how many of
//                                                   // that product ONE
//                                                   // bundle contains
// A bundle never stores its own `stock` number — instead, how many
// bundles could be assembled right now is computed live from the current
// stock of its component products. Selling a bundle deducts from those
// components, not from the bundle itself, so there's nothing to keep in
// sync by hand.
// ---------------------------------------------------------------------

// How many complete bundles can currently be assembled, given the live
// stock of each component product. Limited by whichever component runs
// out first (e.g. a bundle needing 2x Serum A + 1x Serum B, with 5 Serum A
// and 2 Serum B in stock, can only be assembled twice).
function bundleAvailableQty(product, allProducts){
  if(!product || !Array.isArray(product.bundleItems) || product.bundleItems.length===0) return 0;
  let min = Infinity;
  for(const comp of product.bundleItems){
    const compProduct = (allProducts||[]).find(x=>x.id===comp.productId);
    const compStock = compProduct ? Number(compProduct.stock||0) : 0;
    const qtyNeeded = Number(comp.qty||1);
    const possible = qtyNeeded>0 ? Math.floor(compStock/qtyNeeded) : 0;
    if(possible < min) min = possible;
  }
  return min===Infinity ? 0 : Math.max(0, min);
}

// The one function everywhere else should call to find out "how many of
// this product/bundle are currently sellable" — works for plain products
// and bundles alike, so callers never need their own if(isBundle) branch.
function availableStock(product, allProducts){
  if(!product) return 0;
  if(product.isBundle) return bundleAvailableQty(product, allProducts);
  return Number(product.stock||0);
}

// A short "Includes: 2x Serum A, 1x Serum B" string for bundle product
// cards/modals. Falls back to the name snapshotted on the bundle item
// itself if the component product can no longer be found (e.g. deleted).
function bundleContentsLabel(product, allProducts){
  if(!product || !Array.isArray(product.bundleItems)) return '';
  return product.bundleItems.map(comp=>{
    const compProduct = (allProducts||[]).find(x=>x.id===comp.productId);
    const name = (compProduct && compProduct.name) || comp.name || 'Item';
    return `${comp.qty}× ${name}`;
  }).join(', ');
}

// Expands an order's line items into the REAL (non-bundle) product/qty
// pairs whose stock actually needs to move — e.g. "1x Starter Set" becomes
// "2x Serum A, 1x Serum B" if that's what the bundle contained. Plain
// (non-bundle) items pass through unchanged. Used whenever stock is
// deducted or restored for an order, so bundle orders adjust the right
// products automatically instead of trying to adjust stock on the bundle's
// own (non-existent) stock field.
function expandItemsForStock(items, allProducts){
  const out = [];
  (items||[]).forEach(item=>{
    const product = (allProducts||[]).find(p=>p.id===item.productId);
    if(product && product.isBundle && Array.isArray(product.bundleItems)){
      product.bundleItems.forEach(comp=>{
        out.push({
          productId: comp.productId,
          qty: Number(comp.qty||1) * Number(item.qty||0),
          bundleName: product.name
        });
      });
    } else {
      out.push({ productId: item.productId, qty: Number(item.qty||0) });
    }
  });
  return out;
}

// Escapes text before it's dropped into innerHTML. Product names/descriptions
// and — importantly — customer-submitted checkout fields (name, phone,
// address, notes) all flow into admin.html and shop.html via innerHTML, so
// without this a customer could type something like <img onerror=...> into
// an order note and have it execute in the admin's browser. Always run any
// user- or admin-entered text through this before interpolating it into a
// template string that gets assigned to innerHTML.
function esc(str){
  return String(str==null ? '' : str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function toast(msg){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------------
// TAWK.TO LIVE CHAT
// ---------------------------------------------------------------------
// Injects the Tawk.to chat bubble if a Property ID + Widget ID have been
// set from admin.html -> Site settings -> "Live chat (Tawk.to)". Safe to
// call more than once — it only ever injects the script tag once.
let _tawkLoaded = false;
function loadTawkWidget(propertyId, widgetId){
  if(_tawkLoaded || !propertyId || !widgetId) return;
  _tawkLoaded = true;
  window.Tawk_API = window.Tawk_API || {};
  window.Tawk_LoadStart = new Date();
  const s1 = document.createElement('script');
  const s0 = document.getElementsByTagName('script')[0];
  s1.async = true;
  s1.src = `https://embed.tawk.to/${propertyId}/${widgetId}`;
  s1.charset = 'UTF-8';
  s1.setAttribute('crossorigin', '*');
  s0.parentNode.insertBefore(s1, s0);
}

// ---------------------------------------------------------------------
// IMAGE UPLOADS (Firebase Storage)
// ---------------------------------------------------------------------
// Uploads a File to Storage under `folder/` and returns its public download
// URL. `onProgress(pct)` is called (0-100) as the upload proceeds, if given.
// Throws if the file is missing, too big, or not an image.
function uploadImageToStorage(file, folder, onProgress){
  return new Promise((resolve, reject)=>{
    if(!file) return reject(new Error('No file selected'));
    if(!file.type || !file.type.startsWith('image/')) return reject(new Error('Please choose an image file'));
    const MAX_MB = 5;
    if(file.size > MAX_MB * 1024 * 1024) return reject(new Error(`Image is too large — please use one under ${MAX_MB}MB`));

    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const path = `${folder}/${Date.now()}_${safeName}`;
    const task = storage.ref(path).put(file);

    task.on('state_changed',
      (snap)=>{
        if(onProgress) onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
      },
      (err)=> reject(err),
      async ()=>{
        try{
          const url = await task.snapshot.ref.getDownloadURL();
          resolve(url);
        }catch(err){ reject(err); }
      }
    );
  });
}

// Wires up a simple "upload image" control: a file <input>, an <img> preview,
// and a hidden text input that holds the resulting Storage URL (which is what
// actually gets saved to Firestore, same as the old manual URL field).
// `existingUrl` pre-fills the preview when editing something that already
// has an image. Call this once per control, right after the modal/form is
// shown with its current values.
function wireImageUpload({ fileInputId, previewId, urlFieldId, progressId, folder, existingUrl }){
  const fileInput = document.getElementById(fileInputId);
  const preview = document.getElementById(previewId);
  const urlField = document.getElementById(urlFieldId);
  const progressEl = progressId ? document.getElementById(progressId) : null;
  if(!fileInput || !urlField) return;

  urlField.value = existingUrl || '';
  if(preview){
    if(existingUrl){ preview.src = existingUrl; preview.style.display = 'block'; }
    else { preview.src = ''; preview.style.display = 'none'; }
  }
  fileInput.value = '';

  fileInput.onchange = async ()=>{
    const file = fileInput.files && fileInput.files[0];
    if(!file) return;
    if(preview){
      preview.src = URL.createObjectURL(file);
      preview.style.display = 'block';
    }
    if(progressEl){ progressEl.style.display = 'block'; progressEl.textContent = 'Uploading… 0%'; }
    try{
      const url = await uploadImageToStorage(file, folder, (pct)=>{
        if(progressEl) progressEl.textContent = `Uploading… ${pct}%`;
      });
      urlField.value = url;
      if(progressEl){ progressEl.textContent = 'Uploaded ✓'; setTimeout(()=>{ progressEl.style.display = 'none'; }, 1500); }
    }catch(err){
      if(progressEl){ progressEl.style.display = 'block'; progressEl.textContent = 'Upload failed: ' + err.message; }
      toast('Image upload failed: ' + err.message);
    }
  };
}

// ---------------------------------------------------------------------
// EMAIL VERIFICATION (6-digit code) — sent via EmailJS, no backend needed
// ---------------------------------------------------------------------
// 1. Create a free account at https://www.emailjs.com
// 2. Add an Email Service (e.g. connect your Gmail) -> copy its Service ID
// 3. Create an Email Template (see login.html setup notes for the fields
//    it needs) -> copy its Template ID
// 4. Account -> General -> copy your Public Key
// 5. Paste all three below.
const EMAILJS_PUBLIC_KEY  = "0pdHuo0q6aXK4JQ0C";
const EMAILJS_SERVICE_ID  = "service_d3xge4c";
const EMAILJS_TEMPLATE_ID = "template_kzn9owe";

function generateSixDigitCode(){
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Basic client-side throttle so the "Resend code" button (or anyone calling
// emailjs.send directly with the public key visible in this file) can't fire
// off unlimited emails. This is a courtesy speed bump, NOT real protection —
// it lives in the browser and can be bypassed by anyone editing JS locally.
// The actual fix is in your EmailJS dashboard: Email Services -> your
// service -> restrict allowed origins/domains, and consider enabling
// EmailJS's built-in rate limiting so THIS key can only be used from your
// own domain, capped per hour.
const VERIFICATION_CODE_COOLDOWN_MS = 30 * 1000; // 30 seconds between sends
let _lastVerificationCodeSentAt = 0;

// Creates a fresh code, stores it (10 min expiry), and emails it via EmailJS.
async function sendVerificationCode(uid, email, name){
  const sinceLast = Date.now() - _lastVerificationCodeSentAt;
  if(sinceLast < VERIFICATION_CODE_COOLDOWN_MS){
    const waitSec = Math.ceil((VERIFICATION_CODE_COOLDOWN_MS - sinceLast) / 1000);
    throw new Error(`Please wait ${waitSec}s before requesting another code.`);
  }
  _lastVerificationCodeSentAt = Date.now();
  const code = generateSixDigitCode();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes from now

  await db.collection('emailVerifications').doc(uid).set({
    code,
    email,
    expiresAt,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
    to_email: email,
    to_name: name || email,
    code: code
  }, EMAILJS_PUBLIC_KEY);
}

// Checks a code the user typed in against what's stored for their uid.
// Returns {ok:true} on success, or {ok:false, reason:'expired'|'wrong'|'no-code'}.
async function checkVerificationCode(uid, enteredCode){
  const ref = db.collection('emailVerifications').doc(uid);
  const doc = await ref.get();
  if(!doc.exists) return { ok:false, reason:'no-code' };

  const data = doc.data();
  if(Date.now() > data.expiresAt) return { ok:false, reason:'expired' };
  if(String(enteredCode).trim() !== String(data.code)) return { ok:false, reason:'wrong' };

  await db.collection('users').doc(uid).update({ emailVerified: true });
  await ref.delete();
  return { ok:true };
}

// ---------------------------------------------------------------------
// ORDER STATUS CHANGE NOTIFICATIONS (client-side, no backend needed)
// Used by both shop.js (a one-time check right after sign-in) and
// account.js (live, while the "My orders" tab is open) so a customer
// finds out an order moved forward even if they never think to check
// account.html — reduces "where's my order" messages.
// ---------------------------------------------------------------------
const CUSTOMER_ORDER_STATUS_LABELS = {new:'Pending review', confirmed:'Approved', processing:'Processing', shipped:'Shipped', done:'Delivered', cancelled:'Cancelled', returned:'Returned to seller', damaged:'Damaged in transit'};

// Compares this customer's current order statuses against the last
// snapshot saved in localStorage, and toasts anything that changed since
// the last time this function ran for them (e.g. an admin marked
// something "Shipped" while they were away). The very first time it ever
// runs for a given uid it just records the starting snapshot silently —
// nobody needs a toast for the state their orders were already in.
function notifyOrderStatusChanges(orders, uid){
  if(!uid) return;
  const key = `bloome_orderstatus_${uid}`;
  let prev = {};
  try{ prev = JSON.parse(localStorage.getItem(key) || 'null') || {}; }catch(err){ prev = {}; }
  const seenBefore = (()=>{ try{ return localStorage.getItem(key + '_seen') === '1'; }catch(err){ return false; } })();
  const next = {};
  const changes = [];
  (orders||[]).forEach(o=>{
    const status = o.status || 'new';
    next[o.id] = status;
    if(seenBefore && prev[o.id] && prev[o.id] !== status){
      const label = CUSTOMER_ORDER_STATUS_LABELS[status] || status;
      changes.push(`Order #${o.id.slice(-8).toUpperCase()} is now "${label}"`);
    }
  });
  try{
    localStorage.setItem(key, JSON.stringify(next));
    localStorage.setItem(key + '_seen', '1');
  }catch(err){ console.error('Could not save order-status snapshot', err); }
  // Staggered so multiple changed orders don't all flash past at once.
  changes.forEach((msg, i)=> setTimeout(()=>toast(msg), i * 3200));
}

// Optional: emails the customer when their order reaches a milestone
// status (payment verified / shipped / delivered). Leave
// EMAILJS_ORDER_UPDATE_TEMPLATE_ID blank to skip email entirely and rely
// only on the in-app toast above — this quietly no-ops if it's unset, or
// if the order has no email on file (e.g. a manual/offline sale), so it's
// always safe to call from admin.js without extra guards at the call site.
const EMAILJS_ORDER_UPDATE_TEMPLATE_ID = ""; // see login.html setup notes, step 8, to enable
async function sendOrderStatusEmail(order, statusLabel){
  if(!EMAILJS_ORDER_UPDATE_TEMPLATE_ID || !order || !order.email) return;
  try{
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_ORDER_UPDATE_TEMPLATE_ID, {
      to_email: order.email,
      to_name: order.customerName || order.email,
      order_id: (order.id||'').slice(-8).toUpperCase(),
      status: statusLabel,
      courier: order.courier || order.shippingMethod || '',
      tracking_number: order.trackingNumber || ''
    }, EMAILJS_PUBLIC_KEY);
  }catch(err){ console.error('Could not send order status email', err); }
}

// ---------------------------------------------------------------------
// INVOICE EMAIL — sent once, when an admin marks a payment as verified
// (see admin.js verifyPayment()). Leave EMAILJS_INVOICE_TEMPLATE_ID blank
// to skip this and fall back to the plain sendOrderStatusEmail() above.
// See login.html setup notes, step 9, for how to build the template.
// ---------------------------------------------------------------------
const EMAILJS_INVOICE_TEMPLATE_ID = "template_u4st33w";

// Builds a small HTML <table> of line items to drop into the {{items_html}}
// merge tag. Kept separate from the send function so it's easy to unit-test
// or reuse (e.g. from a future "resend invoice" button) without re-sending.
function buildInvoiceItemsHtml(items){
  const rows = (items||[]).map(i=>{
    const qty = Number(i.qty||0);
    const price = Number(i.price||0);
    return `<tr>
      <td style="padding:6px 10px; border-bottom:1px solid #eee;">${esc(i.name)||'Item'}</td>
      <td style="padding:6px 10px; border-bottom:1px solid #eee; text-align:center;">${qty}</td>
      <td style="padding:6px 10px; border-bottom:1px solid #eee; text-align:right;">${money(price)}</td>
      <td style="padding:6px 10px; border-bottom:1px solid #eee; text-align:right;">${money(qty*price)}</td>
    </tr>`;
  }).join('');
  return `<table style="width:100%; border-collapse:collapse; font-size:13px;">
    <thead><tr>
      <th style="text-align:left; padding:6px 10px; border-bottom:2px solid #333;">Item</th>
      <th style="text-align:center; padding:6px 10px; border-bottom:2px solid #333;">Qty</th>
      <th style="text-align:right; padding:6px 10px; border-bottom:2px solid #333;">Price</th>
      <th style="text-align:right; padding:6px 10px; border-bottom:2px solid #333;">Line total</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// Called right after an order's paymentStatus flips to 'verified'. Safe to
// call unconditionally — it quietly no-ops if the template ID is blank or
// the order has no email on file (e.g. a manual/offline sale).
async function sendOrderInvoiceEmail(order){
  if(!EMAILJS_INVOICE_TEMPLATE_ID || !order || !order.email) return;
  const methodLabel = order.paymentMethod === 'gcash' ? 'GCash'
    : order.paymentMethod === 'bank' ? 'Bank/InstaPay'
    : order.paymentMethod === 'credit' ? 'Store credit'
    : '—';
  const orderDate = order.createdAt && order.createdAt.toDate ? order.createdAt.toDate().toLocaleDateString() : '';
  try{
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_INVOICE_TEMPLATE_ID, {
      to_email: order.email,
      to_name: order.customerName || order.email,
      order_id: (order.id||'').slice(-8).toUpperCase(),
      order_date: orderDate,
      items_html: buildInvoiceItemsHtml(order.items),
      subtotal: money(order.subtotal != null ? order.subtotal : order.total),
      shipping_fee: money(order.shippingFee || 0),
      credit_applied: money(order.creditApplied || 0),
      total: money(order.total),
      payment_method: methodLabel,
      payment_reference: order.paymentReference || '—',
      delivery_address: order.address || '',
      courier: order.shippingMethod || order.courier || '',
      current_year: new Date().getFullYear()
    }, EMAILJS_PUBLIC_KEY);
  }catch(err){ console.error('Could not send invoice email', err); }
}

// ---------------------------------------------------------------------
// REFERRAL PROGRAM HELPERS
// A customer's referral link is just login.html?ref=<their uid> — the
// new sign-up stamps that uid straight onto their own account doc as
// referredByUid, so there's no separate code->uid lookup/query needed
// (which would otherwise require read access to a stranger's user doc).
// The short "code" shown in the UI is just a friendlier display form of
// the same uid.
// ---------------------------------------------------------------------
function referralCodeFor(uid){
  return (uid || '').slice(0, 8).toUpperCase();
}
function referralLinkFor(uid){
  const dir = window.location.pathname.replace(/[^/]*$/, '');
  return `${window.location.origin}${dir}login.html?ref=${uid}`;
}

// ---------------------------------------------------------------------
// ROLE HELPERS
// Every signed-in user gets a matching document at users/{uid} with a
// "role" field — either "customer" or "admin". New sign-ups from
// login.html are always created as "customer". To make someone an
// admin, open Firestore -> users -> their document, and change
// role to "admin" by hand (see setup notes in login.html).
// ---------------------------------------------------------------------
async function getUserRole(uid){
  try{
    const doc = await db.collection('users').doc(uid).get();
    if(doc.exists) return doc.data().role || 'customer';
    return null;
  }catch(err){
    console.error('Could not read user role', err);
    return null;
  }
}

// Ensures a users/{uid} doc exists (used right after sign-up, and as a
// safety net for accounts that existed before this system was added).
async function ensureUserDoc(user, defaultRole){
  const ref = db.collection('users').doc(user.uid);
  const doc = await ref.get();
  if(!doc.exists){
    await ref.set({
      email: user.email,
      role: defaultRole || 'customer',
      emailVerified: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return defaultRole || 'customer';
  }
  return doc.data().role || 'customer';
}

// Sends the signed-in user to the right home page for their role.
function redirectForRole(role){
  if(role === 'admin') window.location.href = 'admin.html';
  else window.location.href = 'shop.html';
}

// Call this at the top of a protected page (shop.html / admin.html).
// allowedRoles: array like ['customer','admin'] or ['admin'].
// If nobody is signed in, or their role isn't allowed here, they are
// redirected to login.html (or to their own correct home page).
function requireRole(allowedRoles, onReady){
  auth.onAuthStateChanged(async (user)=>{
    if(!user){
      window.location.href = 'login.html';
      return;
    }
    const role = await ensureUserDoc(user, 'customer');

    // Check verification status. Accounts created before this system was
    // added never got an emailVerified field at all — treat those as
    // already verified (grandfathered) rather than locking people out.
    // Only an explicit `false` blocks access.
    const userDoc = await db.collection('users').doc(user.uid).get();
    const data = userDoc.exists ? userDoc.data() : {};
    const isVerified = data.emailVerified !== false;

    if(!isVerified){
      window.location.href = 'login.html?verify=1';
      return;
    }
    if(!allowedRoles.includes(role)){
      redirectForRole(role);
      return;
    }
    onReady(user, role);
  });
}