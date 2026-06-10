import { db, auth } from "./modules/firebase-config.js";
import { 
    doc, setDoc, getDoc, collection, addDoc, serverTimestamp, updateDoc, deleteDoc, getDocs 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

async function runSecuritySimulation() {
    console.log("🛡️ STARTING FIRESTORE RULES SECURITY SIMULATION...");
    
    const results = [];

    const testAction = async (label, actionFn) => {
        try {
            await actionFn();
            results.push({ scenario: label, result: "PASS (Allowed)" });
        } catch (e) {
            results.push({ scenario: label, result: `FAIL (Denied: ${e.code || e.message})` });
        }
    };

    // Note: This script runs in the browser context where the agent is logged in.
    // I will check the current user's role first to interpret the results correctly.
    const user = auth.currentUser;
    if (!user) {
        console.error("No user logged in. Please login to run simulation.");
        return;
    }
    
    const userDoc = await getDoc(doc(db, "users", user.uid));
    const role = userDoc.data()?.role;
    console.log(`Current logged in role: ${role}`);

    const logCol = collection(db, "system_logs");
    const dummyLog = {
        actionType: "SECURITY_TEST",
        timestamp: serverTimestamp(),
        actorEmail: user.email,
        targetEmail: "test@example.com"
    };

    // 1. Create Log (Depends on current role)
    await testAction(`${role} create log`, async () => {
        await addDoc(logCol, dummyLog);
    });

    // 2. Read Log (Depends on current role)
    await testAction(`${role} read log`, async () => {
        await getDocs(logCol);
    });

    // 3. Update Log (Should always fail per rules)
    await testAction(`${role} update log`, async () => {
        // Try to update the first log found
        const snap = await getDocs(logCol);
        if (!snap.empty) {
            await updateDoc(doc(db, "system_logs", snap.docs[0].id), { tampered: true });
        } else {
            throw new Error("No logs to test update on");
        }
    });

    // 4. Delete Log (Should always fail per rules)
    await testAction(`${role} delete log`, async () => {
        const snap = await getDocs(logCol);
        if (!snap.empty) {
            await deleteDoc(doc(db, "system_logs", snap.docs[0].id));
        } else {
            throw new Error("No logs to test delete on");
        }
    });

    console.table(results);
    document.body.innerHTML += "<h2>Security Simulation Results</h2><pre>" + JSON.stringify(results, null, 2) + "</pre>";
}

runSecuritySimulation();
