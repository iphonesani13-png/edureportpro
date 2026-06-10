import { db } from "./modules/firebase-config.js";
import { collection, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

async function runActualAudit() {
    console.log("🚀 STARTING ACTUAL DATABASE AUDIT...");
    
    try {
        const usersCol = collection(db, "users");
        // We can't use where() easily without indexes for everything, so we fetch all and filter in JS for the audit
        const snapshot = await getDocs(usersCol);
        
        const allUsers = snapshot.docs.map(doc => ({
            uid: doc.id,
            ...doc.data()
        }));

        const targetRoles = ['OWNER', 'SUPER_ADMIN', 'ADMIN'];
        const auditedUsers = allUsers.filter(u => targetRoles.includes(u.role));

        console.log("📊 AUDIT RESULT (OWNER, SUPER_ADMIN, ADMIN):");
        console.table(auditedUsers.map(u => ({
            uid: u.uid,
            email: u.email,
            role: u.role,
            name: u.name,
            createdAt: u.createdAt?.toDate ? u.createdAt.toDate().toISOString() : u.createdAt,
            updatedAt: u.updatedAt?.toDate ? u.updatedAt.toDate().toISOString() : u.updatedAt
        })));

        console.log("📈 ROLE COUNTS:");
        const counts = auditedUsers.reduce((acc, u) => {
            acc[u.role] = (acc[u.role] || 0) + 1;
            return acc;
        }, {});
        console.log(JSON.stringify(counts));

        console.log("🔍 INVESTIGATING SPECIFIC ACCOUNTS...");
        const specificEmails = [
            'rizkialbatamy@gmail.com',
            'iphonesani13@gmail.com',
            'memorifikriyah@gmail.com'
        ];
        
        const specificUsers = allUsers.filter(u => specificEmails.includes(u.email));
        console.table(specificUsers.map(u => ({
            email: u.email,
            role: u.role,
            status: u.status,
            updatedAt: u.updatedAt?.toDate ? u.updatedAt.toDate().toISOString() : u.updatedAt
        })));

        // Check for prior GURU role in history if exists
        // (Assuming there might be a field like 'role_history' or similar, though not in schema)
        // We'll look for clues in 'updatedAt' vs 'createdAt'
        
        console.log("✅ AUDIT COMPLETE.");
        
        // Signal completion for the browser tool
        document.body.innerHTML = "<h1>AUDIT COMPLETE</h1><pre>" + JSON.stringify(auditedUsers, null, 2) + "</pre>";
        window.AUDIT_DATA = auditedUsers;

    } catch (error) {
        console.error("❌ AUDIT FAILED:", error);
        document.body.innerHTML = "<h1 style='color:red'>AUDIT FAILED</h1><pre>" + error.stack + "</pre>";
    }
}

runActualAudit();
