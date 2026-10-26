import { useEffect, useRef, useState } from "react";
import { C4_KIND_LABELS, type C4Content, type C4Element, type C4Relationship } from "../c4.ts";
import { c4RecordEdit } from "../render/c4.ts";
import type { AdapterProps } from "./types.ts";

/** Drafts retain the version they read; a concurrent revision cannot silently rebase a user's text. */
export default function C4Inspector({
  props,
  collection,
  record,
  navigate,
  canNavigate,
}: {
  props: AdapterProps;
  collection: "elements" | "relationships";
  record: C4Element | C4Relationship;
  canNavigate: boolean;
  navigate(id: string): void;
}) {
  const [base, setBase] = useState(props.model);
  const [values, setValues] = useState({
    label: record.label,
    description: record.description ?? "",
    technology: record.technology ?? "",
  });
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const latest = useRef(props);
  latest.current = props;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty && !pending) {
      setBase(props.model);
      setValues({
        label: record.label,
        description: record.description ?? "",
        technology: record.technology ?? "",
      });
    }
  }, [props.model, record, dirty, pending]);
  const element = collection === "elements" ? (record as C4Element) : undefined;
  const content = props.model.content as unknown as C4Content;
  const parent = element?.parentId
    ? content.elements.find((e) => e.id === element.parentId)
    : undefined;
  const relatedViews = element
    ? content.views.filter((view) => view.scope === element.id && view.kind !== "context")
    : [];
  const editable = !!props.onEdit && props.active !== false;
  const save = async () => {
    if (!editable || pending) return;
    const onEdit = props.onEdit!;
    setPending(true);
    setStatus("");
    try {
      await onEdit(
        c4RecordEdit(base, collection, record.id, {
          ...values,
          technology: values.technology || null,
        }),
      );
      if (mounted.current && latest.current.active !== false) {
        setDirty(false);
        setStatus("Edit returned by host.");
      }
    } catch (error) {
      if (mounted.current && latest.current.active !== false)
        setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  return (
    <aside
      className="bvm-c4-inspector"
      aria-label="Architecture inspector"
      tabIndex={props.active === false ? -1 : 0}
    >
      <p className="bvm-c4-eyebrow">
        {element ? C4_KIND_LABELS[element.kind] : "Directed relationship"}
        {element?.external ? " · External" : ""}
      </p>
      <h4>{record.label}</h4>
      {parent && (
        <p>
          Within <strong>{parent.label}</strong>
        </p>
      )}
      {!element && (
        <p>
          {content.elements.find((e) => e.id === (record as C4Relationship).source)?.label} →{" "}
          {content.elements.find((e) => e.id === (record as C4Relationship).target)?.label}
        </p>
      )}
      {!!relatedViews.length && (
        <div className="bvm-c4-drill" aria-label="Architecture drill-down">
          {relatedViews.map((view) => (
            <button
              type="button"
              key={view.id}
              disabled={props.active === false || !canNavigate}
              onClick={() => navigate(view.id)}
            >
              Open {view.kind === "container" ? "containers" : "components"}: {view.label}
            </button>
          ))}
        </div>
      )}
      {props.onEdit ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {(["label", "technology", "description"] as const).map((field) => (
            <label key={field}>
              {field === "label"
                ? "Name or relationship"
                : field === "technology"
                  ? "Technology / protocol"
                  : "Responsibility / description"}
              {field === "description" ? (
                <textarea
                  value={values[field]}
                  maxLength={4000}
                  disabled={!editable || pending}
                  onChange={(e) => {
                    setDirty(true);
                    setValues({ ...values, [field]: e.target.value });
                  }}
                />
              ) : (
                <input
                  value={values[field]}
                  maxLength={240}
                  required={field === "label"}
                  disabled={!editable || pending}
                  onChange={(e) => {
                    setDirty(true);
                    setValues({ ...values, [field]: e.target.value });
                  }}
                />
              )}
            </label>
          ))}
          {dirty && base.revision !== props.model.revision && (
            <p role="status">
              The model changed. Saving checks the revision you edited; reload the draft to use the
              current values.
            </p>
          )}
          <div className="bvm-c4-actions">
            <button type="submit" disabled={!dirty || pending || !editable}>
              Save details
            </button>
            <button
              type="button"
              disabled={pending || !editable}
              onClick={() => {
                setDirty(false);
                setStatus("");
              }}
            >
              Reload draft
            </button>
          </div>
        </form>
      ) : (
        <>
          <p>{record.description}</p>
          {record.technology && (
            <p>
              <strong>Technology / protocol:</strong> {record.technology}
            </p>
          )}
        </>
      )}
      {status && <p role="status">{status}</p>}
    </aside>
  );
}
