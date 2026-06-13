import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const prodConfig = {
    apiKey: "AIzaSyAKURaZ1qn3hX264SQdVd-FHuKpXcBL8RI",
    authDomain: "smpitlaatahzan-raport.firebaseapp.com",
    projectId: "smpitlaatahzan-raport",
    storageBucket: "smpitlaatahzan-raport.firebasestorage.app",
    messagingSenderId: "888443305012",
    appId: "1:888443305012:web:5869fab053efecfd3bde61"
};

const stagingConfig = {
    apiKey: "AIzaSyBmTUcp0fV7SP5yUPp3i1120P-h6paadv0",
    authDomain: "smpit-raport-staging.firebaseapp.com",
    projectId: "smpit-raport-staging",
    storageBucket: "smpit-raport-staging.firebasestorage.app",
    messagingSenderId: "435721896158",
    appId: "1:435721896158:web:e623f9693648bf4acdc24f"
};

// Menentukan environment
let isStaging = false;
if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    // Gunakan staging jika berjalan di localhost atau domain staging
    isStaging = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.includes('staging');
} else {
    // Di Node.js (script manual), default ke staging untuk keamanan
    // kecuali secara spesifik mengatur process.env.USE_PROD
    isStaging = !(typeof process !== 'undefined' && process.env && process.env.USE_PROD);
}

const firebaseConfig = isStaging ? stagingConfig : prodConfig;

if (typeof window !== 'undefined') {
    console.log(`[Firebase] Initializing with ${isStaging ? 'STAGING' : 'PRODUCTION'} config.`);
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
