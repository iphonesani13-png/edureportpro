import { auth, provider, db } from "./firebase-config.js";
import { signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, setDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/**
 * Access Matrix V2 - Auth Engine
 */

export const loginWithGoogle = async (role) => {
    localStorage.setItem('login_intent_role', role);
    return await signInWithPopup(auth, provider);
};

export const logout = async () => {
    return await signOut(auth);
};

/**
 * Mendapatkan profil user lengkap dengan role dan status
 */
export const getUserProfile = async (uid) => {
    const userDocRef = doc(db, 'users', uid);
    const userDoc = await getDoc(userDocRef);
    if (userDoc.exists()) {
        return userDoc.data();
    }
    return null;
};

/**
 * Mengecek apakah email terdaftar di database authorized_users
 */
export const checkAuthorizedEmail = async (email) => {
    const q = query(collection(db, 'authorized_users'), where('email', '==', email));
    const snap = await getDocs(q);
    if (!snap.empty) {
        return { authorized: true, ...snap.docs[0].data() };
    }
    return { authorized: false };
};

export const saveUserProfile = async (uid, data) => {
    const userDocRef = doc(db, 'users', uid);
    return await setDoc(userDocRef, {
        ...data,
        updatedAt: new Date().toISOString()
    }, { merge: true });
};

/**
 * Mendaftarkan user baru dengan status PENDING
 */
export const registerPendingUser = async (uid, userData) => {
    const userDocRef = doc(db, 'users', uid);
    const initialData = {
        uid,
        email: userData.email,
        name: userData.name,
        role: userData.role || 'GURU', // Default role dari UI
        status: 'pending',
        managedSubjects: [],
        createdAt: new Date().toISOString()
    };
    await setDoc(userDocRef, initialData, { merge: true });
    return initialData;
};
