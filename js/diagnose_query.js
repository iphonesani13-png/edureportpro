import { db } from "./modules/firebase-config.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

async function diagnoseQuery() {
    console.log("🔍 DIAGNOSING GURU SHINTA QUERY...");
    
    // Simulating Shinta's filter
    const managedClasses = ["7A", "7B", "9"];
    
    try {
        console.log("Step 1: Attempting filtered query...");
        const q = query(collection(db, "students"), where("kelas", "in", managedClasses));
        const snap = await getDocs(q);
        console.log(`✅ Success! Found ${snap.size} students.`);
        
        if (snap.size > 0) {
            console.log("Sample Data:", snap.docs[0].id, snap.docs[0].data().kelas);
        }
    } catch (e) {
        console.error("❌ Filtered Query Failed:", e.message);
        if (e.code === 'permission-denied') {
            console.error("Cause: Firestore Rules rejected the query.");
        }
    }

    try {
        console.log("\nStep 2: Attempting unfiltered query (expected to fail for Guru)...");
        const q2 = collection(db, "students");
        const snap2 = await getDocs(q2);
        console.log(`✅ Unfiltered Success? (Found ${snap2.size} - This means rules are loose!)`);
    } catch (e) {
        console.warn("✅ Unfiltered Denied as expected:", e.message);
    }
}

diagnoseQuery();
