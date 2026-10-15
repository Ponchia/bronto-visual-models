import { VisualModelError } from "../model.ts";
export const CHART_TABLE_PAGE_SIZE = 25;
export const CHART_TABLE_MAX_COLUMNS = 40;
/** Discover sparse columns once per immutable row collection, independent of the viewed page. */
export function chartTableColumns(rows: readonly Record<string, unknown>[]): string[] {
  const columns = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) columns.add(key);
  return [...columns];
}
function pageIndex(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new VisualModelError("invalid", "A table page is a non-negative integer");
}
/** Bounded row/column window. Accepts the caller's already-discovered schema; never changes rows. */
export function chartTableWindow(
  rows: readonly Record<string, unknown>[],
  allColumns: readonly string[],
  requestedPage = 0,
  requestedColumnPage = 0,
) {
  pageIndex(requestedPage);
  pageIndex(requestedColumnPage);
  const pageCount = Math.max(1, Math.ceil(rows.length / CHART_TABLE_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount - 1),
    start = page * CHART_TABLE_PAGE_SIZE;
  const columnPageCount = Math.max(1, Math.ceil(allColumns.length / CHART_TABLE_MAX_COLUMNS));
  const columnPage = Math.min(requestedColumnPage, columnPageCount - 1),
    columnStart = columnPage * CHART_TABLE_MAX_COLUMNS;
  const columns = allColumns.slice(columnStart, columnStart + CHART_TABLE_MAX_COLUMNS);
  return {
    columns,
    omittedColumns: allColumns.length - columns.length,
    rows: rows.slice(start, start + CHART_TABLE_PAGE_SIZE),
    total: rows.length,
    start,
    page,
    pageCount,
    columnPage,
    columnPageCount,
    columnStart,
    totalColumns: allColumns.length,
  };
}
/** Existing convenience API; a third argument enables additional column pages without clipping source. */
export function chartTablePage(
  rows: readonly Record<string, unknown>[],
  requestedPage = 0,
  requestedColumnPage = 0,
) {
  return chartTableWindow(rows, chartTableColumns(rows), requestedPage, requestedColumnPage);
}
/** Plain text, never markup or links. Undefined (absent) and JSON null remain distinct. */
export function chartCellFullText(value: unknown): string {
  return value === undefined
    ? "—"
    : typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? "—");
}
export function chartCellText(value: unknown): string {
  const text = chartCellFullText(value);
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}
