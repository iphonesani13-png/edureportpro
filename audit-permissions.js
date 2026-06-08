(async () => {
    const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
    const { db } = await import("./js/modules/firebase-config.js");
    
    console.log("%c--- SMPIT TRACKER: PERMISSION HYGIENE AUDIT ---", "color: #4f46e5; font-weight: bold; font-size: 14px;");
    
    const snap = await getDocs(collection(db, "users"));
    const dirtyUsers = [];

    // 1. SCAN
    snap.forEach(userDoc => {
        const data = userDoc.data();
        const role = (data.role || "").toUpperCase();
        
        if (role !== "GURU") {
            const hasOrphanSubjects = data.managedSubjects && data.managedSubjects.length > 0;
            const hasOrphanClasses = data.managedClasses && data.managedClasses.length > 0;

            if (hasOrphanSubjects || hasOrphanClasses) {
                dirtyUsers.push({
                    id: userDoc.id,
                    name: data.name || "Unknown",
                    email: data.email || "No Email",
                    role: role,
                    managedSubjects: data.managedSubjects ? data.managedSubjects.join(', ') : "[]",
                    managedClasses: data.managedClasses ? data.managedClasses.join(', ') : "[]"
                });
            }
        }
    });

    // 2. REPORT
    if (dirtyUsers.length === 0) {
        console.log("✅ Data Hygiene Sempurna. Tidak ada Orphan Permissions yang ditemukan.");
        return;
    }

    console.log(`⚠️ Ditemukan ${dirtyUsers.length} user dengan Orphan Permissions:`);
    console.table(dirtyUsers);

    // 3. CLEANUP SCRIPT GENERATION (Not executing, just providing)
    console.log("\n%c--- MIGRATION SCRIPT ---", "color: #eab308; font-weight: bold;");
    console.log("Untuk membersihkan data di atas, salin dan jalankan fungsi berikut:");
    
    const migrationCode = `
async function cleanOrphanPermissions() {
    const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
    const { db } = await import("./js/modules/firebase-config.js");
    const dirtyIds = ${JSON.stringify(dirtyUsers.map(u => u.id))};
    
    console.log("Mulai membersihkan " + dirtyIds.length + " user...");
    for (const uid of dirtyIds) {
        await updateDoc(doc(db, "users", uid), {
            managedSubjects: [],
            managedClasses: []
        });
        console.log("Dibersihkan: " + uid);
    }
    console.log("✅ Pembersihan Selesai!");
}
cleanOrphanPermissions();
    `;
    console.log(migrationCode);
})();