/** Gzip transfer budgets, not memory or rendering-performance claims. */
export const BUNDLE_LIMITS = Object.freeze({
  initialJavaScript: 128 * 1024,
  totalJavaScript: 1250 * 1024,
  applicationJavaScript: 600 * 1024,
  optionalLayoutWorker: 650 * 1024,
  // The new lazy Vega-Lite compiler/interpreter is a scoped feature allowance,
  // not extra headroom for the pre-existing UI, core entry, or other renderers.
  optionalChartAdapter: 110 * 1024,
  largestApplicationAsset: 215 * 1024,
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
  const renderers =
    /(?:GraphView|MatrixView|TimelineView|GanttView|ModelDataView|ChartView|vega-surface)/;
  for (const key of eager) {
    if (renderers.test(`${key} ${manifest[key].file}`))
      throw new Error(`Renderer was promoted into the initial bundle: ${key}`);
  }
  if (Object.keys(sizes).some((file) => /elk\.bundled/.test(file)))
    throw new Error("The worker-backed demo must not bundle a second in-process ELK engine");
  const js = Object.entries(sizes).filter(([file]) => file.endsWith(".js"));
  // The separately requested ELK worker is not an application entry or renderer.
  // Keep its own explicit budget rather than relaxing the existing renderer limits.
  const layoutWorkers = js.filter(([file]) => /\/elk-worker(?:\.min)?[-.]/.test(file));
  const optionalCharts = js.filter(([file]) => /\/ChartView[-.]/.test(file));
  const application = js.filter(([file]) => !layoutWorkers.some(([worker]) => worker === file));
  const existingApplication = application.filter(
    ([file]) => !optionalCharts.some(([chart]) => chart === file),
  );
  const css = Object.entries(sizes).filter(([file]) => file.endsWith(".css"));
  const initialFiles = [...new Set([...eager].map((key) => manifest[key].file))];
  for (const file of initialFiles) if (!sizes[file]) throw new Error(`Missing size for ${file}`);
  const measurements = {
    initialJavaScript: initialFiles.reduce((sum, file) => sum + sizes[file].gzip, 0),
    totalJavaScript: js.reduce((sum, [, size]) => sum + size.gzip, 0),
    applicationJavaScript: existingApplication.reduce((sum, [, size]) => sum + size.gzip, 0),
    optionalChartAdapter: optionalCharts.reduce((sum, [, size]) => sum + size.gzip, 0),
    optionalLayoutWorker: layoutWorkers.reduce((sum, [, size]) => sum + size.gzip, 0),
    largestApplicationAsset: Math.max(0, ...application.map(([, size]) => size.gzip)),
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
