"use strict";

const fs = require("node:fs");
const path = require("node:path");

const file = path.resolve(__dirname, "..", "src", "services", "deck-manager-v2.cjs");
let content = fs.readFileSync(file, "utf8");
const before = `        const layout = normalizeLayout(payload, target);
        Object.assign(target, layout);
        const maximum = layout.rows * layout.columns;
        const buttonArray = this.buttons(profile, payload.folderId || "root");
        if (buttonArray.length > maximum) {
          const overflow = buttonArray.slice(maximum).filter(Boolean);
          if (overflow.length) throw new Error(\`Raster zu klein: \${overflow.length} belegte Taste(n) würden verloren gehen\`);
        }
        buttonArray.length = Math.min(buttonArray.length, maximum);
        return this.save();`;
const after = `        const layout = normalizeLayout(payload, target);
        const maximum = layout.rows * layout.columns;
        const buttonArray = this.buttons(profile, payload.folderId || "root");
        if (buttonArray.length > maximum) {
          const overflow = buttonArray.slice(maximum).filter(Boolean);
          if (overflow.length) throw new Error(\`Raster zu klein: \${overflow.length} belegte Taste(n) würden verloren gehen\`);
        }
        Object.assign(target, layout);
        buttonArray.length = Math.min(buttonArray.length, maximum);
        return this.save();`;
if (!content.includes(before)) throw new Error("Deck-Sicherheits-Patchpunkt fehlt");
content = content.replace(before, after);
fs.writeFileSync(file, content, "utf8");
console.log("Batto OBS Tool 2.0.0: Rasteränderung ist transaktional abgesichert.");
