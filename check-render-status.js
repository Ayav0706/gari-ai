const API_KEY = "rnd_Mvcz4TvloakmthSqcrY5XTuVu6Mi";
const SERVICE_ID = "srv-d6lk1tkhg0os73c6lilg";

async function main() {
    const res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/deploys?limit=3`, {
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Accept": "application/json"
        }
    });
    const data = await res.json();
    for (const item of data) {
        const dep = item.deploy || item;
        console.log("ID:", dep.id);
        console.log("Status:", dep.status);
        console.log("Created:", dep.createdAt);
        console.log("Finished:", dep.finishedAt || "N/A");
        console.log("Commit:", dep.commit?.message?.slice(0, 80) || "N/A");
        console.log("---");
    }
}
main();
