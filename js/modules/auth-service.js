import { auth, provider, db } from "./firebase-config.js";
import { signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- DAFTAR EMAIL GURU YANG DIIZINKAN (WHITELIST) ---
export const AUTHORIZED_TEACHER_EMAILS = [
    "admin@gmail.com",
    "guru1@gmail.com",
    "kepsek@gmail.com",
    "iphonesani13@gmail.com",
    "rizkialbatamy@gmail.com"
];

export const AUTHORIZED_DOMAIN = "";

export const loginWithGoogle = async (role) => {
    localStorage.setItem('login_intent_role', role);
    return await signInWithPopup(auth, provider);
};

export const logout = async () => {
    return await signOut(auth);
};

export const checkTeacherAuthorization = (email) => {
    if (AUTHORIZED_DOMAIN && email.endsWith(AUTHORIZED_DOMAIN)) return true;
    return AUTHORIZED_TEACHER_EMAILS.includes(email);
};

export const getUserProfile = async (uid) => {
    const userDocRef = doc(db, 'users', uid);
    const userDoc = await getDoc(userDocRef);
    if (userDoc.exists()) {
        return userDoc.data();
    }
    return null;
};

export const saveUserProfile = async (uid, data) => {
    const userDocRef = doc(db, 'users', uid);
    return await setDoc(userDocRef, data, { merge: true });
};
