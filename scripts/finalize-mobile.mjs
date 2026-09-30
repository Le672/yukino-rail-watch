import fs from "node:fs";
fs.renameSync("dist-mobile/mobile.html", "dist-mobile/index.html");
// Keep the bundled app independent from remotely deployed HTML.
console.log("Mobile assets ready in dist-mobile/index.html");
