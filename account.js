// =====================================================================
// ACCOUNT.HTML — customer "My orders" + profile page
// Requires firebase-config.js to be loaded first.
// =====================================================================

const ORDER_STATUS_LABELS = {new:'Pending review', confirmed:'Approved', processing:'Processing', shipped:'Shipped', done:'Delivered', cancelled:'Cancelled', returned:'Returned to seller', damaged:'Damaged in transit'};
// How far each status is along the visual progress bar (0-4), so
// "cancelled" just shows as its own pill rather than a broken progress bar.
const ORDER_STATUS_STEP = {new:0, confirmed:1, processing:2, shipped:3, done:4};

let currentUser = null;

// ============================================================
// AUTH GATE
// ============================================================
requireRole(['customer','admin'], (user)=>{
  currentUser = user;
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('accountRoot').style.display = 'block';
  document.getElementById('accountAvatar').textContent = (user.email||'?').charAt(0).toUpperCase();

  loadProfile(user);
  listenMyOrders(user.uid);
  loadReferralInfo(user);
  loadReferralProgramSetting();
});

document.getElementById('signOutBtn').addEventListener('click', ()=>{
  auth.signOut().then(()=>{ window.location.href = 'login.html'; });
});

document.getElementById('menuToggle').addEventListener('click', ()=>{
  document.getElementById('navLinks').classList.toggle('open');
});

// ============================================================
// TABS
// ============================================================
document.querySelectorAll('.account-tab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.account-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tabOrders').style.display = btn.dataset.tab==='tabOrders' ? 'block' : 'none';
    document.getElementById('tabProfile').style.display = btn.dataset.tab==='tabProfile' ? 'block' : 'none';
    document.getElementById('tabReferral').style.display = btn.dataset.tab==='tabReferral' ? 'block' : 'none';
  });
});

// ============================================================
// PROFILE
// ============================================================
async function loadProfile(user){
  try{
    const doc = await db.collection('users').doc(user.uid).get();
    const data = doc.exists ? doc.data() : {};
    const label = data.name ? data.name.split(' ')[0] : (user.email ? user.email.split('@')[0] : 'there');
    document.getElementById('accountLabel').textContent = `Hi, ${label}`;
    document.getElementById('welcomeName').textContent = data.name ? `, ${data.name.split(' ')[0]}` : '';
    document.getElementById('profName').value = data.name || '';
    document.getElementById('profEmail').value = user.email || '';
    document.getElementById('profPhone').value = data.phone || '';
    document.getElementById('profAddress').value = data.address || '';
  }catch(err){ console.error('Could not load profile', err); }
}

document.getElementById('saveProfileBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('profName').value.trim();
  const phone = document.getElementById('profPhone').value.trim();
  const address = document.getElementById('profAddress').value.trim();
  const msg = document.getElementById('profileMsg');
  if(!name){
    msg.innerHTML = '<div class="form-msg err">Please enter your name.</div>';
    return;
  }
  try{
    await db.collection('users').doc(currentUser.uid).set({ name, phone, address }, {merge:true});
    msg.innerHTML = '<div class="form-msg ok">Profile saved.</div>';
    document.getElementById('accountLabel').textContent = `Hi, ${name.split(' ')[0]}`;
    document.getElementById('welcomeName').textContent = `, ${name.split(' ')[0]}`;
    toast('Profile saved');
  }catch(err){
    msg.innerHTML = `<div class="form-msg err">${err.message}</div>`;
  }
});

// ============================================================
// REFER & EARN
// ============================================================
// Gate: the referral link/credit UI only unlocks once this customer has at
// least one order that reached "Fulfilled" (done) — a brand-new sign-up, or
// someone whose order is still pending/processing, doesn't see it yet.
// Re-evaluated live off the same orders snapshot used for "My orders", so
// the tab unlocks itself the moment an order is marked fulfilled without
// needing a page refresh.
function updateReferralEligibility(orders){
  const eligible = (orders||[]).some(o=>o.status==='done');
  const lockedEl = document.getElementById('referralLocked');
  const unlockedEl = document.getElementById('referralUnlocked');
  if(lockedEl) lockedEl.style.display = eligible ? 'none' : 'block';
  if(unlockedEl) unlockedEl.style.display = eligible ? 'block' : 'none';
}

// Respects Settings → Referral program → "Off — hide referral tab". Live, so
// flipping it off in admin.html removes the tab here without a page reload
// (and kicks the customer back to Orders if it was the active tab).
function loadReferralProgramSetting(){
  db.collection('settings').doc('site').onSnapshot(doc=>{
    const data = doc.exists ? doc.data() : {};
    const enabled = data.referralEnabled !== false; // default on, matches admin.js's own default
    const tabBtn = document.querySelector('.account-tab[data-tab="tabReferral"]');
    if(!tabBtn) return;
    tabBtn.style.display = enabled ? '' : 'none';
    if(!enabled && tabBtn.classList.contains('active')){
      document.querySelector('.account-tab[data-tab="tabOrders"]').click();
    }
  }, err=>console.error('Could not load referral program setting', err));
}

function loadReferralInfo(user){
  const linkInput = document.getElementById('referralLinkInput');
  if(linkInput) linkInput.value = referralLinkFor(user.uid);

  // Live so the balance updates the moment an admin marks a referral rewarded,
  // without the customer needing to refresh the page.
  db.collection('users').doc(user.uid).onSnapshot(doc=>{
    const data = doc.exists ? doc.data() : {};
    const bal = Number(data.creditBalance||0);
    const el = document.getElementById('referralCreditBalance');
    if(el) el.textContent = money(bal);
  }, err=>console.error('Could not load credit balance', err));

  db.collection('referrals').where('referrerUid','==',user.uid).onSnapshot(snap=>{
    const refs = [];
    snap.forEach(doc=> refs.push({id:doc.id, ...doc.data()}));
    // Sorted client-side (newest first), same reasoning as listenMyOrders.
    refs.sort((a,b)=>{
      const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
    renderReferralList(refs);
  }, err=>{
    console.error(err);
    const wrap = document.getElementById('referralList');
    if(wrap) wrap.innerHTML = '<div class="empty-orders">Could not load your referrals. Please refresh.</div>';
  });
}

function renderReferralList(refs){
  const wrap = document.getElementById('referralList');
  if(!wrap) return;
  if(refs.length===0){
    wrap.innerHTML = '<div class="empty-orders">Nobody yet — share your link above and they\'ll show up here.</div>';
    return;
  }
  wrap.innerHTML = refs.map(r=>{
    const date = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleDateString() : '—';
    const rewarded = r.status === 'rewarded';
    const statusLabel = rewarded ? `Rewarded — ${money(r.rewardAmount||0)}` : 'Pending first order';
    return `
    <div class="order-card">
      <div class="order-card-head">
        <div>
          <strong>${esc(r.referredName) || esc(r.referredEmail) || 'New customer'}</strong>
          <div class="odate">Joined ${date}</div>
        </div>
        <span class="pill ${rewarded ? 'pay-verified' : 'pay-submitted'}">${esc(statusLabel)}</span>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('copyReferralBtn').addEventListener('click', ()=>{
  const input = document.getElementById('referralLinkInput');
  input.select();
  input.setSelectionRange(0, 99999);
  const done = ()=> toast('Referral link copied');
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(input.value).then(done).catch(()=>{
      document.execCommand('copy'); done();
    });
  } else {
    document.execCommand('copy'); done();
  }
});

// ============================================================
// SELF-SERVICE CANCEL (customer-initiated)
// Only allowed while an order is still "new" (pending review) — nothing
// has been confirmed, paid-verified, or shipped yet, so there's no stock
// to put back and no delivery to unwind. Once an admin moves it past
// "new", the button stops showing (see renderOrders) and cancelling
// becomes an admin-only action from that point on. The matching Firestore
// rule enforces this same new->cancelled-only restriction server-side, so
// this can't be bypassed by editing the request by hand.
// ============================================================
async function cancelMyOrder(orderId){
  // Orders paid for (in part or in full) with store credit can't be
  // self-cancelled here: a customer isn't allowed to top up their own
  // credit balance (see the users/{uid} update rule), so refunding it back
  // has to happen from the admin side, where cancelling/deleting an order
  // now correctly restores any credit that was spent on it. This check is
  // just a friendly heads-up — renderOrders() already hides the button in
  // this case; the Firestore rule for order cancellation blocks it too.
  const order = (window._myOrders||[]).find(o=>o.id===orderId);
  if(order && Number(order.creditApplied||0) > 0){
    toast('This order used store credit — please message us to cancel it so your credit can be refunded.');
    return;
  }
  if(!confirm('Cancel this order? This cannot be undone.')) return;
  try{
    await db.collection('orders').doc(orderId).update({
      status: 'cancelled',
      cancelledByCustomer: true,
      cancelledAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('Order cancelled');
  }catch(err){
    console.error(err);
    toast('Could not cancel — please refresh and try again, or contact us.');
  }
}

// ============================================================
// ORDER HISTORY (live)
// ============================================================
function listenMyOrders(uid){
  db.collection('orders').where('customerUid','==',uid).onSnapshot(snap=>{
    const orders = [];
    snap.forEach(doc=> orders.push({id:doc.id, ...doc.data()}));
    // Sorted client-side (newest first) so this doesn't need a composite
    // Firestore index just to load the page.
    orders.sort((a,b)=>{
      const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
    window._myOrders = orders; // so cancelMyOrder can check creditApplied before cancelling
    renderOrders(orders);
    updateReferralEligibility(orders);
    notifyOrderStatusChanges(orders, uid);
  }, err=>{
    console.error(err);
    document.getElementById('ordersList').innerHTML =
      '<div class="empty-orders">Could not load your orders. Please refresh, or contact us if this keeps happening.</div>';
  });
}

function renderOrders(orders){
  const wrap = document.getElementById('ordersList');
  if(orders.length===0){
    wrap.innerHTML = '<div class="empty-orders">No orders yet — once you check out, your order and its status will show up here.</div>';
    return;
  }
  wrap.innerHTML = orders.map(o=>{
    const date = o.createdAt && o.createdAt.toDate ? o.createdAt.toDate().toLocaleString() : 'Just now';
    const status = o.status || 'new';
    const statusLabel = ORDER_STATUS_LABELS[status] || status;
    const payStatus = o.paymentStatus || (o.paymentMethod ? 'submitted' : 'unpaid');
    const payLabel = payStatus==='verified' ? 'Payment verified' : (payStatus==='submitted' ? 'Payment submitted — awaiting verification' : 'No payment info on file');
    const itemsHtml = (o.items||[]).map(i=>`<li>${esc(i.qty)}× ${esc(i.name)} — ${money((i.price||0)*(i.qty||0))}</li>`).join('');
    const step = ORDER_STATUS_STEP[status] != null ? ORDER_STATUS_STEP[status] : 0;
    const nonLinearStatus = ['cancelled','returned','damaged'].includes(status);
    const progressHtml = nonLinearStatus ? '' : `
      <div class="track-steps">
        ${[0,1,2,3].map(i=>`<span class="${i<step ? 'done' : ''}"></span>`).join('')}
      </div>`;
    const trackingHtml = (o.trackingNumber || o.courier) ? `
      <div class="track-box">
        <span class="track-box-head"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg> <strong>${status==='done' ? 'Delivered' : 'On the way'}</strong>${o.courier ? ' via '+esc(o.courier) : ''}</span><br>
        Tracking number: <span class="tnum">${esc(o.trackingNumber)||'—'}</span>
      </div>` : (o.shippingMethod ? `
      <div class="track-box">Preferred courier: <strong>${esc(o.shippingMethod)}</strong></div>` : '');
    return `
    <div class="order-card">
      <div class="order-card-head">
        <div>
          <div class="oid">Order #${esc(o.id.slice(-8).toUpperCase())}</div>
          <div class="odate">${date}</div>
        </div>
        <div class="order-pills">
          <span class="pill status-${status}">${esc(statusLabel)}</span>
          <span class="pill pay-${payStatus}">${payStatus==='verified' ? 'Paid' : (payStatus==='submitted' ? 'Verifying payment' : 'Unpaid')}</span>
        </div>
      </div>
      <ul class="order-items-list">${itemsHtml}</ul>
      ${progressHtml}
      ${trackingHtml}
      ${o.shippingFee>0 ? `<div class="order-total-row" style="font-weight:400; font-size:12.5px; color:var(--plum-soft);"><span>Shipping</span><span>${money(o.shippingFee)}</span></div>` : ''}
      ${o.creditApplied>0 ? `<div class="order-total-row" style="font-weight:400; font-size:12.5px; color:var(--plum-soft);"><span>Store credit applied</span><span>−${money(o.creditApplied)}</span></div>` : ''}
      <div class="order-total-row"><span>Total</span><span>${money(o.total)}</span></div>
      <div style="font-size:11.5px; color:var(--plum-soft); margin-top:6px;">${esc(payLabel)}</div>
      ${status==='new' ? (
        Number(o.creditApplied||0) > 0
          ? `<div style="font-size:11.5px; color:var(--plum-soft); margin-top:10px;">This order used store credit — message us to cancel it so your credit can be refunded.</div>`
          : `<button class="icon-btn danger" style="margin-top:10px;" onclick="cancelMyOrder('${o.id}')">Cancel this order</button>`
      ) : ''}
    </div>`;
  }).join('');
}