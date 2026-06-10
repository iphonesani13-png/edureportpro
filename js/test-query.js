import { db } from "./modules/firebase-config.js";
import { doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

async function testIt() {
    console.log("Testing...");
    try {
        const q = query(collection(db, "students"), where("__name__", "in", ["0101938136"]));
        const snap = await getDocs(q);
        console.log("Found:", snap.size);
    } catch(e) {
        console.error("FAIL:", e.message);
    }
}
testIt();
