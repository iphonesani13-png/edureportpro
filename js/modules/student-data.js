import { db, auth } from "./firebase-config.js";
import { 
    doc, getDoc, setDoc, collection, onSnapshot, query, where 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export const getStudentByNis = async (nis) => {
    const studentRef = doc(db, 'students', String(nis));
    return await getDoc(studentRef);
};

export const linkChildToParent = async (parentUid, childId) => {
    const userRef = doc(db, 'users', parentUid);
    return await setDoc(userRef, { childId: childId }, { merge: true });
};

export const autoFixStudentData = async (st, subjectsList) => {
    let needsUpdate = false;
    // Deep clone to avoid mutating original if needed
    const data = { ...st };

    if (data.academic) { delete data.academic; needsUpdate = true; }
    if (data.poin === undefined) { data.poin = 0; needsUpdate = true; }
    if (!data.point_history) { data.point_history = []; needsUpdate = true; }
    if (!data.base_tahun) { data.base_tahun = '2025/2026'; needsUpdate = true; }
    if (!data.base_kelas) { data.base_kelas = data.kelas || '7'; needsUpdate = true; }
    if (!data.kelas) { data.kelas = data.base_kelas; needsUpdate = true; }

    if (!data.subjects || !Array.isArray(data.subjects)) {
        data.subjects = subjectsList.map(name => ({ 
            name: name, score_harian: 0, score_tugas: 0, score_uh: 0, score_pts: 0, score_pas: 0, score_pat: 0, 
            note: '', last_updated_date: '' 
        }));
        needsUpdate = true;
    } else {
        data.subjects.forEach(sub => {
            if (sub.score !== undefined) {
                sub.score_harian = sub.score;
                delete sub.score;
                needsUpdate = true;
            }
            if (sub.score_harian === undefined) { sub.score_harian = 0; needsUpdate = true; }
            if (sub.score_tugas === undefined) { sub.score_tugas = 0; needsUpdate = true; }
            if (sub.score_uh === undefined) { sub.score_uh = 0; needsUpdate = true; }
            if (sub.score_pts === undefined) { sub.score_pts = 0; needsUpdate = true; }
            if (sub.score_pas === undefined) { sub.score_pas = 0; needsUpdate = true; }
            if (sub.score_pat === undefined) { sub.score_pat = 0; needsUpdate = true; }
            if (sub.last_updated_date === undefined) { sub.last_updated_date = ''; needsUpdate = true; }
        });
    }

    if (needsUpdate) {
        await setDoc(doc(db, 'students', data.docId), data, { merge: true });
        return true;
    }
    return false;
};

export const streamStudents = (callback) => {
    let q = collection(db, 'students');
    
    console.log(`[Firestore] Querying ALL students (Client will filter based on Role & Year progression)`);

    return onSnapshot(q, (snapshot) => {
        console.log(`[Firestore] Received ${snapshot.size} students.`);
        const data = snapshot.docs.map(d => ({ docId: d.id, ...d.data() }));
        callback(data);
    }, (error) => {
        console.error("🔥 STREAM_STUDENTS_ERROR:", error.code, error.message);
    });
};

export const streamAssignments = (callback) => {
    const assignCol = collection(db, 'assignments');
    return onSnapshot(assignCol, (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(data);
    }, (error) => {
        console.error("🔥 STREAM_ASSIGNMENTS_ERROR:", error.code, error.message);
    });
};

export const streamSingleStudent = (childId, callback, onError) => {
    const studentRef = doc(db, 'students', childId);
    return onSnapshot(studentRef, (docSnap) => {
        if (docSnap.exists()) {
            callback({ docId: docSnap.id, ...docSnap.data() });
        } else {
            onError("Not Found");
        }
    }, onError);
};
