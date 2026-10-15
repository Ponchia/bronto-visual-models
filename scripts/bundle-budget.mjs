/** Gzip transfer budgets, not memory or rendering-performance claims. */
export const BUNDLE_LIMITS = Object.freeze({
  initialJavaScript: 128 * 1024,
  totalJavaScript: 600 * 1024,
  largestJavaScript: 215 * 1024,
  totalCss: 12 * 1024,
  nativeRenderer: 10 * 1024,
});
export function bundleReport(manifest, sizes) {
  const entries = Object.keys(manifest).filter((key) => manifest[key].isEntry);
  if (!entries.length) throw new Error("A bundle entry is required");
  const eager = new Set();
  const visit = (key) => {
    if (eager.has(key)) return;
    if (!manifest[key]) throw new Error(`Missing bundle import: ${key}`);
    eager.add(key);
    for (const child of manifest[key].imports ?? []) visit(child);
  };
  entries.forEach(visit);
  const renderers = /(?:GraphView|MatrixView|TimelineView|GanttView|ModelDataView)/;
  for (const key of eager) {
    if (renderers.test(`${key} ${manifest[key].file}`))
      throw new Error(`Renderer was promoted into the initial bundle: ${key}`);
  }
  const js = Object.entries(sizes).filter(([file]) => file.endsWith(".js"));
  const css = Object.entries(sizes).filter(([file]) => file.endsWith(".css"));
  const initialFiles = [...new Set([...eager].map((key) => manifest[key].file))];
  for (const file of initialFiles) if (!sizes[file]) throw new Error(`Missing size for ${file}`);
  const measurements = {
    initialJavaScript: initialFiles.reduce((sum, file) => sum + sizes[file].gzip, 0),
    totalJavaScript: js.reduce((sum, [, size]) => sum + size.gzip, 0),
    largestJavaScript: Math.max(0, ...js.map(([, size]) => size.gzip)),
    totalCss: css.reduce((sum, [, size]) => sum + size.gzip, 0),
    nativeRenderer: Math.max(
      0,
      ...js.filter(([file]) => /GanttView|ModelDataView/.test(file)).map(([, size]) => size.gzip),
    ),
  };
  for (const [name, limit] of Object.entries(BUNDLE_LIMITS)) {
    if (measurements[name] > limit)
      throw new Error(`${name}: ${measurements[name]} gzip bytes exceeds ${limit}`);
  }
  return { units: "gzip bytes", limits: BUNDLE_LIMITS, measurements, initialFiles, assets: sizes };
}
