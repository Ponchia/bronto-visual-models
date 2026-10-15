import { mkdirSync, copyFileSync } from "node:fs";
mkdirSync("dist/react", { recursive: true });
for (const file of ["styles.css", "base.css"])
  copyFileSync(`src/react/${file}`, `dist/react/${file}`);
