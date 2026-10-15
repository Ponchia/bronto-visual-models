import { VisualModelError } from "../model.ts";

export const CHART_TABLE_PAGE_SIZE = 25;
export const CHART_TABLE_MAX_COLUMNS = 40;
/** Explicitly bounded presentation of already-validated inline rows. No sort/filter mutation. */
export function chartTablePage(rows: readonly Record<string, unknown>[], requestedPage = 0) {
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 0)
    throw new VisualModelError("invalid", "A table page is a non-negative integer");
  const allColumns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const pageCount = Math.max(1, Math.ceil(rows.length / CHART_TABLE_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount - 1);
  const start = page * CHART_TABLE_PAGE_SIZE;
  return {
    columns: allColumns.slice(0, CHART_TABLE_MAX_COLUMNS),
    omittedColumns: Math.max(0, allColumns.length - CHART_TABLE_MAX_COLUMNS),
    rows: rows.slice(start, start + CHART_TABLE_PAGE_SIZE),
    total: rows.length,
    start,
    page,
    pageCount,
  };
}
/** Text only: data labels, HTML fragments and URLs never become links or markup. */
export function chartCellText(value: unknown): string {
  const text =
    value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);
  return (text ?? "—").length > 240 ? `${text!.slice(0, 239)}…` : (text ?? "—");
}
