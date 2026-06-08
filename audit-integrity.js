(async () => {
    const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
    const { db } = await import("./js/modules/firebase-config.js");
    
    console.log("%c--- SMPIT TRACKER: REFERENTIAL INTEGRITY AUDIT ---", "color: #eab308; font-weight: bold; font-size: 14px;");
    
    // 1. Fetch Subjects
    const subjectsSnap = await getDocs(collection(db, "subjects"));
    const validSubjectIds = new Set();
    const duplicateTracker = new Set();
    const duplicates = [];

    subjectsSnap.forEach(doc => {
        const id = doc.id;
        if (validSubjectIds.has(id)) {
            duplicates.push(id);
        } else {
            validSubjectIds.add(id);
        }
    });

    // 2. Fetch Users
    const usersSnap = await getDocs(collection(db, "users"));
    const inconsistencies = [];

    usersSnap.forEach(doc => {
        const user = doc.data();
        if (user.managedSubjects && Array.isArray(user.managedSubjects)) {
            // Check for duplicates within user's own array
            const uniqueUserSubjects = new Set(user.managedSubjects);
            if (uniqueUserSubjects.size !== user.managedSubjects.length) {
                inconsistencies.push({
                    uid: doc.id,
                    name: user.name,
                    issue: "Duplicate Subject in managedSubjects array",
                    details: user.managedSubjects.join(', ')
                });
            }

            // Check against valid subjects
            user.managedSubjects.forEach(subjectId => {
                if (!validSubjectIds.has(subjectId)) {
                    inconsistencies.push({
                        uid: doc.id,
                        name: user.name,
                        issue: "Invalid/Missing Subject ID",
                        details: subjectId
                    });
                }
            });
        }
    });

    // 3. Report
    console.log("--- HASIL AUDIT ---");
    if (duplicates.length > 0) {
        console.warn("⚠️ Ditemukan Duplikat ID pada Koleksi Subjects:");
        console.table(duplicates);
    } else {
        console.log("✅ Tidak ada duplikat pada Koleksi Subjects.");
    }

    if (inconsistencies.length > 0) {
        console.warn(`⚠️ Ditemukan ${inconsistencies.length} masalah Integritas Referensial pada Koleksi Users:`);
        console.table(inconsistencies);
    } else {
        console.log("✅ Integritas Referensial Sempurna. Semua managedSubjects valid.");
    }

})();