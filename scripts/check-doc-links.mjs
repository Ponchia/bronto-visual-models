import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
const files = [
  "README.md",
  "AGENTS.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
];
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) visit(path);
    else if (entry.name.endsWith(".md")) files.push(path);
  }
}
visit("docs");
const failures = [];
for (const file of files) {
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const match of text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1].split("#")[0];
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    if (!existsSync(resolve(dirname(file), decodeURIComponent(href))))
      failures.push(`${file}: ${href}`);
  }
}
if (failures.length) throw new Error(`Broken local documentation links:\n${failures.join("\n")}`);
console.log(`Documentation links checked across ${files.length} files.`);
