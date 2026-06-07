import { db, auth } from "./firebase-config.js";
import { 
    doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, serverTimestamp, runTransaction, addDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/**
 * AssessmentService V1.1 (Multi-Assessment Model)
 * Academic Engine for SMPIT Tracker
 */

/**
 * Mendapatkan daftar template TP berdasarkan mata pelajaran
 */
export const getTemplatesBySubject = async (subjectId, academicYear) => {
    const q = query(
        collection(db, "assessment_templates"), 
        where("subjectId", "==", subjectId),
        where("academicYear", "==", academicYear)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

/**
 * Mendapatkan detail mata pelajaran (untuk KKM)
 */
export const getSubjectDetails = async (subjectId) => {
    const snap = await getDoc(doc(db, "subjects", subjectId));
    return snap.exists() ? snap.data() : null;
};

/**
 * Mendapatkan seluruh aktivitas penilaian published untuk Rekap
 */
export const getAllPublishedAssessments = async (subjectId, classId, academicYear) => {
    const q = query(
        collection(db, "assessments"),
        where("subjectId", "==", subjectId),
        where("classId", "==", classId),
        where("academicYear", "==", academicYear),
        where("status", "==", "published")
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

/**
 * Mendapatkan daftar aktivitas penilaian untuk TP dan Kelas tertentu
 */
export const getAssessmentsByFilter = async (templateId, classId) => {
    const q = query(
        collection(db, "assessments"),
        where("templateId", "==", templateId),
        where("classId", "==", classId)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

/**
 * Mendapatkan satu dokumen assessment berdasarkan ID
 */
export const getAssessmentById = async (assessmentId) => {
    const docRef = doc(db, "assessments", assessmentId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
        return { id: snap.id, ...snap.data() };
    }
    return null;
};

/**
 * Validasi Publish sesuai PRD
 */
const validatePublish = (scores, reflection, totalStudents) => {
    const scoreCount = Object.values(scores).filter(s => s > 0).length;
    if (scoreCount < totalStudents) {
        throw new Error(`Gagal Publish: Masih ada ${totalStudents - scoreCount} siswa yang belum memiliki nilai.`);
    }
    if (!reflection || reflection.trim().length < 10) {
        throw new Error("Gagal Publish: Refleksi guru minimal 10 karakter.");
    }
    return true;
};

/**
 * Menyimpan atau Update data assessment (Multi-Assessment)
 */
export const saveAssessment = async (assessmentId, assessmentData, isPublish = false, totalStudents = 0) => {
    const user = auth.currentUser;
    if (!user) throw new Error("User tidak terautentikasi.");
    
    const teacherId = user.uid;

    if (isPublish) {
        validatePublish(assessmentData.scores || {}, assessmentData.teacherReflection, totalStudents);
    }

    const baseData = {
        ...assessmentData,
        updatedAt: serverTimestamp(),
        updatedBy: teacherId,
        gradingStatus: isPublish ? "completed" : "ongoing" // New V1.1 Field
    };

    if (isPublish) {
        baseData.status = "published";
        baseData.publishedAt = serverTimestamp();
        baseData.publishedBy = teacherId;
    }

    if (!assessmentId) {
        // CREATE NEW (Auto-ID)
        const docRef = await addDoc(collection(db, "assessments"), {
            ...baseData,
            status: isPublish ? "published" : "draft",
            createdAt: serverTimestamp(),
            createdBy: teacherId,
            isRemedial: false,
            originalAssessmentId: null
        });
        return docRef.id;
    } else {
        // UPDATE EXISTING
        const docRef = doc(db, "assessments", assessmentId);
        await runTransaction(db, async (transaction) => {
            const snap = await transaction.get(docRef);
            if (!snap.exists()) throw new Error("Dokumen tidak ditemukan.");
            
            const existing = snap.data();
            if (existing.status === "published" && !isPublish) {
                // Principal/Admin can override this via rules, but logic prevents it for teachers
                if (user.role !== 'admin' && user.role !== 'principal') {
                    throw new Error("Dokumen sudah dipublish dan terkunci.");
                }
            }
            transaction.update(docRef, baseData);
        });
        return assessmentId;
    }
};

/**
 * Mengambil daftar siswa (Parallel Query Optimization)
 */
export const getStudentsInClass = async (classId) => {
    const classSnap = await getDoc(doc(db, "classes", classId));
    if (!classSnap.exists()) return [];

    const studentIds = classSnap.data().studentIds || [];
    if (studentIds.length === 0) return [];

    const chunks = [];
    for (let i = 0; i < studentIds.length; i += 30) {
        chunks.push(studentIds.slice(i, i + 30));
    }

    const promises = chunks.map(chunk => {
        const q = query(collection(db, "students"), where("__name__", "in", chunk));
        return getDocs(q);
    });

    const snapshots = await Promise.all(promises);
    const students = [];
    snapshots.forEach(snap => {
        snap.forEach(d => students.push({ id: d.id, ...d.data() }));
    });

    return students.sort((a, b) => (a.nama || "").localeCompare(b.nama || ""));
};

/**
 * KURIKULUM V2: Menambah TP baru
 */
export const addTemplate = async (templateData) => {
    const docRef = await addDoc(collection(db, "assessment_templates"), {
        ...templateData,
        createdAt: serverTimestamp(),
        status: "aktif"
    });
    return docRef.id;
};

/**
 * KURIKULUM V2: Update TP
 */
export const updateTemplate = async (id, data) => {
    const docRef = doc(db, "assessment_templates", id);
    await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp()
    });
};

/**
 * KURIKULUM V2: Hapus TP (Hanya jika belum ada nilai)
 */
export const deleteTemplate = async (id) => {
    // Check if any assessments exist for this template
    const q = query(collection(db, "assessments"), where("templateId", "==", id));
    const snap = await getDocs(q);
    if (!snap.empty) {
        throw new Error("Gagal Hapus: Materi ini sudah memiliki data nilai siswa. Silakan hapus nilai terlebih dahulu atau ubah status menjadi arsip.");
    }
    const docRef = doc(db, "assessment_templates", id);
    // Hard delete for templates is allowed if no assessments exist
    // In the future, we might prefer soft-delete (status: archived)
    await updateDoc(docRef, { status: "deleted", deletedAt: serverTimestamp() });
};

/**
 * KURIKULUM V2: Update Konfigurasi Mapel (CP & KKM)
 */
export const updateSubjectConfig = async (subjectId, config) => {
    const docRef = doc(db, "subjects", subjectId);
    await updateDoc(docRef, {
        ...config,
        updatedAt: serverTimestamp()
    });
};
