import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";

/** Automated checks complement, not replace, keyboard and assistive-technology review. */
export async function checkAccessibility(page, path, include) {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]);
  if (include) builder = builder.include(include);
  const report = await builder.analyze();
  await writeFile(path, JSON.stringify(report, null, 2));
  const violations = report.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
  }));
  return {
    path: String(path),
    passed: report.passes.length,
    incomplete: report.incomplete.length,
    violations,
  };
}
