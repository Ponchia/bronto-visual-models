const field = { type: "string", minLength: 1, maxLength: 64, pattern: "^[A-Za-z][A-Za-z0-9_]*$" };
export const TIMELINE_SOURCE_FIELDS = {
  datasource: { type: "string", enum: ["dataset"] },
  params: {
    type: "object",
    required: ["dataset"],
    additionalProperties: false,
    properties: {
      dataset: { type: "string", minLength: 1, maxLength: 200 },
      revision: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      since: { type: "string", maxLength: 40 },
      until: { type: "string", maxLength: 40 },
    },
  },
  fields: {
    type: "object",
    required: ["label", "start"],
    additionalProperties: false,
    properties: { label: field, start: field, end: field, lane: field, entity: field },
  },
} as const;

export interface TimelineFields {
  label: string;
  start: string;
  end?: string;
  lane?: string;
  entity?: string;
}

/** An ISO timestamp with an explicit offset, in epoch milliseconds; NaN for anything else. */
export function offsetInstant(value: string): number {
  return /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : Number.NaN;
}
