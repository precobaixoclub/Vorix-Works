fetch("http://zuno-api:3000/v1/platform/plans").then(r=>r.text()).then(t=>console.log("INTERNAL:", t.slice(0,80))).catch(e=>console.log("INTERNAL ERR:", e.message));
fetch("https://api.vorixworks.com/v1/platform/plans").then(r=>r.text()).then(t=>console.log("PUBLIC:", t.slice(0,80))).catch(e=>console.log("PUBLIC ERR:", e.message));
