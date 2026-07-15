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

// Creates a fresh code, stores it (10 min expiry), and emails it via EmailJS.
async function sendVerificationCode(uid, email, name){
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
