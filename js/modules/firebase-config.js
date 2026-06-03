import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAKURaZ1qn3hX264SQdVd-FHuKpXcBL8RI",
    authDomain: "smpitlaatahzan-raport.firebaseapp.com",
    projectId: "smpitlaatahzan-raport",
    storageBucket: "smpitlaatahzan-raport.firebasestorage.app",
    messagingSenderId: "888443305012",
    appId: "1:888443305012:web:5869fab053efecfd3bde61"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
