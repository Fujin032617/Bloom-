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
    renderOrders(orders);
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
        📦 <strong>${status==='done' ? 'Delivered' : 'On the way'}</strong>${o.courier ? ' via '+esc(o.courier) : ''}<br>
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
      <div class="order-total-row"><span>Total</span><span>${money(o.total)}</span></div>
      <div style="font-size:11.5px; color:var(--plum-soft); margin-top:6px;">${esc(payLabel)}</div>
    </div>`;
  }).join('');
}