import { sha256Hex } from "../hash.ts";
import { isVisualRecordId, VisualModelError } from "../model.ts";
import { SEMANTIC_LIMITS, TIMELINE_SCHEMA, type TimelineContent } from "../semantic.ts";
import { offsetInstant, type TimelineFields } from "../timeline-source.ts";
import {
  datasetSearchText,
  defineVisualFamily,
  SEMANTIC_FIELDS,
  SEMANTIC_SEARCH,
  type VisualIssue,
} from "./family.ts";

const HOUR = 3_600_000;
const instant = (value: unknown) => Number.isFinite(new Date(value as number).getTime());

function timelineIssues(content: Record<string, unknown>): VisualIssue[] {
  const timeline = content as unknown as TimelineContent;
  const issues: VisualIssue[] = [];
  if (content.datasource) {
    if (!content.params || !content.fields || timeline.events.length || timeline.lanes.length)
      issues.push({
        path: ["datasource"],
        message:
          "Dataset timelines require field mappings and empty authored lanes/events; source facts are read-only and never mixed with inline content.",
      });
    const params = (content.params ?? {}) as { since?: string; until?: string };
    for (const bound of ["since", "until"] as const) {
      const value = params[bound];
      if (value !== undefined && !Number.isFinite(offsetInstant(value)))
        issues.push({
          path: ["params", bound],
          message: "Dataset timeline bounds require ISO timestamps with an explicit timezone.",
        });
    }
    if (params.since && params.until && offsetInstant(params.until) <= offsetInstant(params.since))
      issues.push({
        path: ["params", "until"],
        message: "Dataset timeline observation bounds must end after they start.",
      });
  } else
    for (const field of ["params", "fields"])
      if (content[field])
        issues.push({
          path: [field],
          message: "Timeline source fields require a dataset binding.",
        });
  const lanes = new Set(timeline.lanes.map((lane) => lane.id));
  for (const event of timeline.events) {
    if (!lanes.has(event.lane))
      issues.push({
        path: ["events", event.id, "lane"],
        message: "Every timeline event needs an existing lane",
      });
    if (!instant(event.start))
      issues.push({
        path: ["events", event.id, "start"],
        message: "Timeline times must be valid instants",
      });
    else if (event.end !== undefined && (!instant(event.end) || event.end <= event.start))
      issues.push({
        path: ["events", event.id, "end"],
        message: "Timeline ranges must end after they start",
      });
  }
  return issues;
}

function rowInstant(value: unknown, field: string, row: string): number {
  // Numeric inputs are epoch milliseconds. Text needs an explicit offset, not a device's timezone.
  const time =
    typeof value === "number" ? value : typeof value === "string" ? offsetInstant(value) : NaN;
  if (!Number.isFinite(time) || !Number.isFinite(new Date(time).getTime()))
    throw new VisualModelError(
      "invalid",
      `Dataset row ${row}: ${field} must be epoch milliseconds or an ISO timestamp with a timezone.`,
    );
  return time;
}

/** A derived timeline keeps dataset identity; it never writes projected rows into authored content. */
export function timelineFromRows(
  rows: readonly Readonly<Record<string, unknown>>[],
  fields: TimelineFields,
): TimelineContent {
  if (rows.length > SEMANTIC_LIMITS.timelineEvents)
    throw new VisualModelError(
      "invalid",
      `A timeline supports at most ${SEMANTIC_LIMITS.timelineEvents} events. Narrow the dataset time window.`,
    );
  const lanes = new Map<string, { id: string; label: string }>();
  const seen = new Set<string>();
  const events = rows.map((row) => {
    if (typeof row.rowId !== "string" || !row.rowId || seen.has(row.rowId))
      throw new VisualModelError("invalid", "Dataset events require unique source row identities.");
    seen.add(row.rowId);
    const text = row[fields.label];
    if (typeof text !== "string" || !text.trim() || text.length > SEMANTIC_LIMITS.label)
      throw new VisualModelError(
        "invalid",
        `Dataset row ${row.rowId}: ${fields.label} must be a nonempty label of at most ${SEMANTIC_LIMITS.label} characters.`,
      );
    const lane = fields.lane ? row[fields.lane] : "Events";
    if (typeof lane !== "string" || !lane.trim() || lane.length > SEMANTIC_LIMITS.label)
      throw new VisualModelError(
        "invalid",
        `Dataset row ${row.rowId}: the lane must be a nonempty label of at most ${SEMANTIC_LIMITS.label} characters.`,
      );
    const laneId = `lane-${sha256Hex(lane)}`;
    lanes.set(laneId, { id: laneId, label: lane });
    if (lanes.size > SEMANTIC_LIMITS.timelineLanes)
      throw new VisualModelError(
        "invalid",
        `A timeline supports at most ${SEMANTIC_LIMITS.timelineLanes} lanes. Choose a coarser lane column.`,
      );
    const start = rowInstant(row[fields.start], fields.start, row.rowId);
    const rawEnd = fields.end ? row[fields.end] : undefined;
    const end =
      rawEnd == null || rawEnd === ""
        ? undefined
        : rowInstant(rawEnd, fields.end ?? "end", row.rowId);
    if (end !== undefined && end <= start)
      throw new VisualModelError(
        "invalid",
        `Dataset row ${row.rowId}: its end must follow its start.`,
      );
    const entity = fields.entity ? row[fields.entity] : undefined;
    if (entity != null && !isVisualRecordId(entity))
      throw new VisualModelError(
        "invalid",
        `Dataset row ${row.rowId}: entity identity is invalid.`,
      );
    return {
      id: `row-${sha256Hex(row.rowId)}`,
      label: text,
      lane: laneId,
      start,
      ...(end === undefined ? {} : { end }),
      ...(typeof entity === "string" ? { entityId: entity } : {}),
    };
  });
  return { lanes: [...lanes.values()], events };
}

const time = (label: string) => ({ label, control: "time", format: "epoch-ms" }) as const;

export const timelineFamily = defineVisualFamily("timeline", {
  schema: TIMELINE_SCHEMA,
  validate: timelineIssues,
  fields: {
    datasource: { label: "Source", section: "Data", readOnly: true },
    params: { label: "Source parameters", section: "Data", readOnly: true },
    fields: { label: "Field mapping", section: "Data", readOnly: true },
  },
  // A dataset timeline shows source facts; nothing is authored beside them.
  additions: (content) =>
    content.datasource
      ? []
      : [
          { label: "Add event", collection: "events" },
          { label: "Add lane", collection: "lanes" },
        ],
  collections: {
    lanes: {
      search: SEMANTIC_SEARCH,
      fields: SEMANTIC_FIELDS,
      newItem: (_content, { id }) => ({ id, label: "New lane" }),
      removalNote: "Move or remove this lane’s events before removing the lane.",
    },
    events: {
      search: SEMANTIC_SEARCH,
      fields: {
        ...SEMANTIC_FIELDS,
        lane: { label: "Lane", control: "ref", ref: "lanes", order: 2 },
        start: { ...time("Start"), order: 3 },
        end: { ...time("End"), order: 4 },
      },
      // A new event follows the last one, in the first lane.
      newItem: (content, { id }) => {
        const timeline = content as unknown as TimelineContent;
        const lane = timeline.lanes[0];
        if (!lane) throw new VisualModelError("invalid", "Add a lane before creating events.");
        const last = timeline.events.at(-1);
        const start = last?.end ?? last?.start ?? Date.now();
        return { id, label: "New event", lane: lane.id, start, end: start + HOUR };
      },
    },
  },
  searchText: datasetSearchText,
  fromRows: (rows, content) => ({
    timeline: timelineFromRows(rows, content.fields as unknown as TimelineFields),
  }),
});
