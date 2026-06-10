import { auth, provider, db } from "./firebase-config.js";
import { signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, setDoc, collection, query, where, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/**
 * Access Matrix V2 - Auth Engine & Role Definitions
 */

export const ROLES = {
    OWNER: 'OWNER',
    SUPER_ADMIN: 'SUPER_ADMIN',
    KURIKULUM: 'KURIKULUM',
    KEPALA_SEKOLAH: 'KEPALA_SEKOLAH',
    GURU: 'GURU',
    ORANG_TUA: 'ORANG_TUA'
};

/**
 * Audit Trail V1: Mencatat perubahan sistemik
 */
export const addAuditLog = async (actionType, targetUid, targetEmail, before, after) => {
    try {
        const actor = auth.currentUser;
        if (!actor) return; // Prevent logging if not logged in

        await addDoc(collection(db, "system_logs"), {
            actionType,
            targetUid,
            targetEmail,
            actorUid: actor.uid,
            actorEmail: actor.email,
            before,
            after,
            timestamp: serverTimestamp()
        });
    } catch (e) {
        console.error("Failed to create audit log:", e);
    }
};

export const loginWithGoogle = async (role) => {
    localStorage.setItem('login_intent_role', (role || '').toUpperCase());
    return await signInWithPopup(auth, provider);
};

export const logout = async () => {
    return await signOut(auth);
};

/**
 * Mendapatkan profil user lengkap dengan role dan status
 */
export const getUserProfile = async (uid) => {
    console.log("AUTH_STEP_PROFILE_START", uid);
    try {
        const userDocRef = doc(db, 'users', uid);
        const userDoc = await getDoc(userDocRef);
        console.log("AUTH_STEP_PROFILE_FETCHED", userDoc.exists());
        if (userDoc.exists()) {
            const data = userDoc.data();
            let normalizedRole = (data.role || '').toUpperCase();
            if (normalizedRole === 'ORANGTUA') normalizedRole = 'ORANG_TUA'; // Map legacy format

            return {
                ...data,
                role: normalizedRole
            };
        }
        return null;
    } catch (e) {
        console.error("AUTH_STEP_PROFILE_EXCEPTION", e.code, e.message);
        throw e; // Rethrow to let caller handle
    }
};

/**
 * Mengecek apakah email terdaftar di database authorized_users
 */
export const checkAuthorizedEmail = async (email) => {
    const q = query(collection(db, 'authorized_users'), where('email', '==', email));
    const snap = await getDocs(q);
    if (!snap.empty) {
        const data = snap.docs[0].data();
        return { 
            authorized: true, 
            ...data, 
            role: (data.role || '').toUpperCase() 
        };
    }
    return { authorized: false };
};

export const saveUserProfile = async (uid, data) => {
    const userDocRef = doc(db, 'users', uid);
    const normalizedData = { ...data };
    if (normalizedData.role) normalizedData.role = normalizedData.role.toUpperCase();
    
    return await setDoc(userDocRef, {
        ...normalizedData,
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
        role: (userData.role || ROLES.GURU).toUpperCase(), 
        status: 'pending',
        managedSubjects: [],
        createdAt: new Date().toISOString()
    };
    await setDoc(userDocRef, initialData, { merge: true });
    return initialData;
};
