// Small, deliberately bounded JSON-Schema subset shared by node-data patches
// and typed agent actions. Schemas are static descriptor data; callers supply
// values only. Keeping one validator prevents action and mutation contracts
// from drifting.

/**
 * One thing wrong with a value, where it is wrong. The path is segments from
 * the validated value's root (`["nodes", "0", "x"]`); the dotted form appears
 * only in the message (`$.nodes[0].x is required`), which reads on its own.
 */
export interface ValidationIssue {
  readonly path: readonly string[];
  readonly message: string;
}

/** How many issues one refusal names; the rest are counted. */
const VALIDATION_ISSUE_LIMIT = 20;

/** Issues as a refusal carries them: at most the limit, and how many more there were. */
export interface IssueReport {
  readonly issues: readonly ValidationIssue[];
  readonly issuesOmitted: number;
}

/** The one way to cap issues: the first VALIDATION_ISSUE_LIMIT, in order, and a count of the rest. */
export function limitIssues(all: readonly ValidationIssue[]): IssueReport {
  return {
    issues: all.slice(0, VALIDATION_ISSUE_LIMIT),
    issuesOmitted: Math.max(0, all.length - VALIDATION_ISSUE_LIMIT),
  };
}

/** The refusal text for a capped list: each issue, then how many more. */
export function describeIssues(report: IssueReport): string {
  return [
    ...report.issues.map((issue) => issue.message),
    ...(report.issuesOmitted > 0 ? [`and ${report.issuesOmitted} more`] : []),
  ].join("; ");
}

/**
 * The fields a refusal body carries for a report: `issues` when there are
 * any, and `issuesOmitted` only when more were counted than listed.
 */
export function issueFields(report: IssueReport | undefined): {
  issues?: readonly ValidationIssue[];
  issuesOmitted?: number;
} {
  if (!report?.issues.length) return {};
  return {
    issues: report.issues,
    ...(report.issuesOmitted > 0 ? { issuesOmitted: report.issuesOmitted } : {}),
  };
}

export class AgentSchemaValidationError extends Error implements IssueReport {
  /** The first issue's dotted path, as every refusal before the issue list named it. */
  readonly path: string;
  readonly issues: readonly ValidationIssue[];
  /** Issues past the limit, counted but not listed. */
  readonly issuesOmitted: number;
  constructor(report: IssueReport, path: string) {
    super(describeIssues(report));
    this.path = path;
    this.issues = report.issues;
    this.issuesOmitted = report.issuesOmitted;
    this.name = "AgentSchemaValidationError";
  }
}

// One step from a value's root: a field name, or an index into an array.
type Step = string | number;

function dotted(steps: readonly Step[]): string {
  return steps.reduce<string>(
    (text, step) => (typeof step === "number" ? `${text}[${step}]` : `${text}.${step}`),
    "$",
  );
}

/** A walk's issues in document order, each with its dotted path. */
class IssueList {
  readonly issues: ValidationIssue[] = [];
  readonly paths: string[] = [];
  add(steps: readonly Step[], message: string): void {
    const at = dotted(steps);
    this.issues.push({ path: steps.map(String), message: `${at} ${message}` });
    this.paths.push(at);
  }
}

// How much of an enum a refusal may quote. Every enum here is static descriptor
// data, so this only guards against a future one growing unreasonably. Sized to
// leave headroom above the longest real enum — the diagram languages, at ~360
// characters — because a truncated list is the failure this exists to avoid.
const MAX_ENUM_HINT_CHARS = 600;

// "is not an allowed value" tells a caller nothing it did not already know. The
// allowed values are the answer, and an agent that has just been refused is
// exactly who needs them — otherwise the only way to learn them is to go and
// read `spatial kinds`, which is a round trip a refusal can spend for free.
function allowedValuesHint(values: readonly unknown[]): string {
  const rendered = values.map((value) => JSON.stringify(value) ?? String(value));
  const kept: string[] = [];
  let length = 0;
  for (const value of rendered) {
    if (length + value.length + 2 > MAX_ENUM_HINT_CHARS) break;
    kept.push(value);
    length += value.length + 2;
  }
  const omitted = rendered.length - kept.length;
  const list = kept.join(", ");
  return omitted > 0 ? `${list}, … (+${omitted} more)` : list;
}

// This is a dialect, not a claim to implement arbitrary JSON Schema. A
// misspelled/unsupported assertion is an author error, even when the value
// never visits that optional field or union branch.
//
// The evaluator below is deliberately not Ajv, and the reason is cost, not
// parity. Over every current schema Ajv 8 reaches the same verdicts and, once
// mapped, the same refusals, given `ownProperties`, keywords derived from these
// descriptors for UTF-16 lengths and finite numbers, and a mapping that keeps
// this file's precedence: enum, then union, then type. But the CLI validates
// flags through this module on every command, and loading Ajv and compiling a
// command's flags costs about 130 ms there, where this costs about 2; a
// browser pays 37 kB gzip more and compiles with eval. Standalone validators
// generated at build time remove both, and with keywords that generate code
// they keep every verdict and refusal. But they replace about 165 lines here
// with a generator, a refusal mapper and 1.5 MB of generated code that the
// CLI and server, run from source, would have to commit. Ajv earns that once
// the dialect above has to grow (references, conditionals, formats). Decision
// 0123 has the corpus and the measurements.
const ANNOTATIONS = new Set(["title", "description", "default", "examples", "$comment"]);
const TYPE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  null: [],
  boolean: [],
  string: ["minLength", "maxLength", "pattern"],
  number: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"],
  integer: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"],
  array: ["items", "minItems", "maxItems", "uniqueItems"],
  object: ["properties", "required", "additionalProperties", "maxProperties"],
};

/** Check trusted contract data without accepting or normalizing an instance. */
export function assertAgentSchema(root: Readonly<Record<string, unknown>>, path = "$"): void {
  const ancestors = new Set<object>();
  const visit = (value: unknown, at: string): void => {
    const fail = (detail: string): never => {
      throw new Error(`Invalid agent schema at ${at}: ${detail}`);
    };
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail("expected a schema object");
    const schema = value as Record<string, unknown>;
    if (ancestors.has(schema) || ancestors.size >= 64) fail("cyclic or overly deep schema");
    const type = schema.type;
    if (type !== undefined && (typeof type !== "string" || !Object.hasOwn(TYPE_KEYWORDS, type)))
      fail("unsupported type");
    if (type === undefined && !Array.isArray(schema.anyOf)) fail("type or anyOf is required");
    const keys = typeof type === "string" ? (TYPE_KEYWORDS[type] ?? []) : [];
    for (const key of Object.keys(schema)) {
      if (!["type", "enum", "anyOf"].includes(key) && !ANNOTATIONS.has(key) && !keys.includes(key))
        fail(`unsupported keyword ${key}`);
      const argument = schema[key];
      if (
        ["minLength", "maxLength", "minItems", "maxItems", "maxProperties"].includes(key) &&
        (!Number.isSafeInteger(argument) || (argument as number) < 0)
      )
        fail(`${key} must be a nonnegative integer`);
      if (
        ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"].includes(key) &&
        (typeof argument !== "number" || !Number.isFinite(argument))
      )
        fail(`${key} must be finite`);
      if (key === "uniqueItems" && typeof argument !== "boolean") fail(`${key} must be boolean`);
    }
    if (
      schema.enum !== undefined &&
      (!Array.isArray(schema.enum) ||
        !schema.enum.length ||
        !schema.enum.every(
          (v) =>
            v === null ||
            ["string", "boolean"].includes(typeof v) ||
            (typeof v === "number" && Number.isFinite(v)),
        ))
    )
      fail("enum must contain primitive JSON values");
    if (
      schema.required !== undefined &&
      (!Array.isArray(schema.required) || !schema.required.every((v) => typeof v === "string"))
    )
      fail("required must contain field names");
    if (schema.pattern !== undefined) {
      if (typeof schema.pattern !== "string") fail("pattern must be a string");
      try {
        new RegExp(schema.pattern as string, "u");
      } catch {
        fail("pattern is not a valid Unicode regular expression");
      }
    }
    ancestors.add(schema);
    try {
      if (schema.anyOf !== undefined) {
        if (!Array.isArray(schema.anyOf) || !schema.anyOf.length) fail("empty or invalid anyOf");
        (schema.anyOf as unknown[]).forEach((branch, index) => {
          visit(branch, `${at}.anyOf[${index}]`);
        });
      }
      if (schema.properties !== undefined) {
        if (
          !schema.properties ||
          typeof schema.properties !== "object" ||
          Array.isArray(schema.properties)
        )
          fail("properties must be an object");
        for (const [field, nested] of Object.entries(schema.properties as Record<string, unknown>))
          visit(nested, `${at}.properties.${field}`);
      }
      if (schema.items !== undefined) visit(schema.items, `${at}.items`);
      if (
        schema.additionalProperties !== undefined &&
        typeof schema.additionalProperties !== "boolean"
      )
        visit(schema.additionalProperties, `${at}.additionalProperties`);
    } finally {
      ancestors.delete(schema);
    }
  };
  visit(root, path);
}

// JSON object key order is not meaning; array order and primitive types are.
function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => equalJson(item, right[index]))
    );
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equalJson(a[key], b[key]))
  );
}

export function validateAgentSchemaValue(
  schema: Readonly<Record<string, unknown>>,
  value: unknown,
  root: readonly string[] = [],
): void {
  assertAgentSchema(schema);
  const found = new IssueList();
  validateValue(schema, value, [...root], found);
  if (found.issues.length)
    throw new AgentSchemaValidationError(limitIssues(found.issues), found.paths[0] ?? "$");
}

/** Adds every issue under `path` to `found`; a schema author's error still throws at once. */
function validateValue(
  schema: Readonly<Record<string, unknown>>,
  value: unknown,
  path: Step[],
  found: IssueList,
): void {
  const invalid = (message: string, at: readonly Step[] = path) => found.add(at, message);
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => candidate === value)) {
    invalid(`is not an allowed value (allowed: ${allowedValuesHint(schema.enum)})`);
    return;
  }

  // A union of the forms this subset already supports, nothing more: the value
  // must satisfy at least one branch. A branch's issues are its own; the
  // refusal names the branch types rather than replaying every branch's
  // issues — "must be a number or a string" is the answer a refused caller
  // needs; three stacked refusals are noise. A schema error inside a branch
  // (the author's bug, not the caller's) still throws through unchanged.
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.filter(
      (branch): branch is Record<string, unknown> =>
        branch !== null && typeof branch === "object" && !Array.isArray(branch),
    );
    if (branches.length === 0)
      throw new Error(`Invalid agent schema at ${dotted(path)}: empty anyOf`);
    const satisfied = branches.some((branch) => {
      const attempt = new IssueList();
      validateValue(branch, value, path, attempt);
      return attempt.issues.length === 0;
    });
    if (!satisfied) {
      const kinds = branches.map((branch) => String(branch.type ?? "value")).join(" or a ");
      invalid(`must be a ${kinds}`);
      return;
    }
    if (schema.type === undefined) return;
  }

  switch (schema.type) {
    case "null":
      if (value !== null) invalid("must be null");
      return;
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        invalid("must be an object");
        return;
      }
      const record = value as Record<string, unknown>;
      const properties =
        schema.properties && typeof schema.properties === "object"
          ? (schema.properties as Record<string, unknown>)
          : {};
      const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
      for (const field of required) {
        if (!Object.hasOwn(record, field)) invalid("is required", [...path, field]);
      }
      if (
        typeof schema.maxProperties === "number" &&
        Object.keys(record).length > schema.maxProperties
      ) {
        invalid(`has more than ${schema.maxProperties} fields`);
      }
      for (const [field, fieldValue] of Object.entries(record)) {
        let fieldSchema = Object.hasOwn(properties, field) ? properties[field] : undefined;
        if (fieldSchema === undefined) {
          if (schema.additionalProperties === false) {
            invalid("is unknown", [...path, field]);
            continue;
          }
          if (typeof schema.additionalProperties !== "object") continue;
          fieldSchema = schema.additionalProperties;
        }
        if (fieldSchema === null || typeof fieldSchema !== "object" || Array.isArray(fieldSchema)) {
          throw new Error(`Invalid agent schema at ${dotted([...path, field])}`);
        }
        validateValue(
          fieldSchema as Readonly<Record<string, unknown>>,
          fieldValue,
          [...path, field],
          found,
        );
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) {
        invalid("must be an array");
        return;
      }
      if (typeof schema.minItems === "number" && value.length < schema.minItems) {
        invalid(`must contain at least ${schema.minItems} items`);
      }
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
        invalid(`has more than ${schema.maxItems} items`);
      }
      if (schema.uniqueItems === true) {
        let duplicated = false;
        for (let index = 0; index < value.length && !duplicated; index += 1) {
          for (let candidate = index + 1; candidate < value.length; candidate += 1) {
            if (equalJson(value[index], value[candidate])) {
              duplicated = true;
              break;
            }
          }
        }
        if (duplicated) invalid("must not contain duplicate items");
      }
      if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
        value.forEach((item, index) => {
          validateValue(
            schema.items as Readonly<Record<string, unknown>>,
            item,
            [...path, index],
            found,
          );
        });
      }
      return;
    }
    case "string": {
      if (typeof value !== "string") {
        invalid("must be a string");
        return;
      }
      // Lengths are JavaScript UTF-16 code units, the unit CLI refusals report
      // (`utf16-code-units`); JSON Schema proper counts code points.
      if (typeof schema.minLength === "number" && value.length < schema.minLength) {
        invalid(`must contain at least ${schema.minLength} characters`);
      } else if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
        invalid(`exceeds ${schema.maxLength} characters`);
      } else if (
        typeof schema.pattern === "string" &&
        !new RegExp(schema.pattern, "u").test(value)
      ) {
        invalid("has an invalid format");
      }
      return;
    }
    case "number":
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) invalid("must be a finite number");
      else if (schema.type === "integer" && !Number.isInteger(value)) invalid("must be an integer");
      else if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum)
        invalid(`must be greater than ${schema.exclusiveMinimum}`);
      else if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum)
        invalid(`must be less than ${schema.exclusiveMaximum}`);
      else if (typeof schema.minimum === "number" && value < schema.minimum)
        invalid(`must be at least ${schema.minimum}`);
      else if (typeof schema.maximum === "number" && value > schema.maximum)
        invalid(`must be at most ${schema.maximum}`);
      return;
    }
    case "boolean":
      if (typeof value !== "boolean") invalid("must be a boolean");
      return;
    default:
      throw new Error(`Unsupported agent schema type at ${dotted(path)}: ${String(schema.type)}`);
  }
}

/** Public, host-neutral names; the original aliases keep existing consumers compatible. */
export { AgentSchemaValidationError as SchemaValidationError, assertAgentSchema as assertSchema, validateAgentSchemaValue as validateSchemaValue };
