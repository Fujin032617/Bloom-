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

// ---------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------
function money(n){
  return '₱' + Number(n||0).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function toast(msg){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2600);
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