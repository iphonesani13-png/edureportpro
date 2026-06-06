import { db, auth } from "./firebase-config.js";
import { 
    doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, serverTimestamp, runTransaction 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/**
 * AssessmentService V1.0 (Refined)
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
 * Mendapatkan dokumen assessment spesifik
 */
export const getAssessment = async (templateId, classId) => {
    const id = `${templateId}_${classId}`;
    const docRef = doc(db, "assessments", id);
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
 * Menyimpan atau Update data assessment menggunakan Transaction
 */
export const saveAssessment = async (template, classId, scores, notes, reflection, isPublish = false, totalStudents = 0) => {
    const user = auth.currentUser;
    if (!user) throw new Error("User tidak terautentikasi.");
    
    const teacherId = user.uid;
    const id = `${template.id}_${classId}`;
    const docRef = doc(db, "assessments", id);

    if (isPublish) {
        validatePublish(scores, reflection, totalStudents);
    }

    return await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(docRef);
        
        const baseData = {
            scores,
            notes,
            teacherReflection: reflection,
            updatedAt: serverTimestamp(),
            updatedBy: teacherId
        };

        if (isPublish) {
            baseData.status = "published";
            baseData.publishedAt = serverTimestamp();
            baseData.publishedBy = teacherId;
        }

        if (!snap.exists()) {
            // Logic Create
            const newData = {
                ...baseData,
                templateId: template.id,
                classId: classId,
                subjectId: template.subjectId,
                teacherId: teacherId,
                academicYear: template.academicYear,
                semester: template.semester,
                status: isPublish ? "published" : "draft",
                createdAt: serverTimestamp(),
                createdBy: teacherId,
                isRemedial: false,
                originalAssessmentId: null
            };
            transaction.set(docRef, newData);
        } else {
            // Logic Update - Proteksi Lock Published (Hanya Admin/Principal via Rules)
            const existingData = snap.data();
            if (existingData.status === "published" && !isPublish) {
                throw new Error("Dokumen sudah dipublish dan terkunci.");
            }
            transaction.update(docRef, baseData);
        }
        
        return id;
    });
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

    return students.sort((a, b) => a.name.localeCompare(b.name));
};
