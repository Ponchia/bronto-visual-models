import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { lint } from "markdownlint/promise";

/** Include new, not-yet-tracked documentation; never follow directory symlinks. */
function markdownIn(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...markdownIn(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) found.push(path);
  }
  return found;
}

const files = [
  ...readdirSync(".", { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name),
  ...markdownIn("docs"),
  ...markdownIn(".github"),
].sort();
const config = JSON.parse(readFileSync(".markdownlint.json", "utf8"));
const result = await lint({ files, config });
const violations = Object.entries(result).flatMap(([file, errors]) =>
  errors.map(
    (error) => `${file}:${error.lineNumber}: ${error.ruleNames.join("/")} ${error.ruleDescription}`,
  ),
);
if (violations.length) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  console.log(`Markdown lint: ${files.length} files passed`);
}
