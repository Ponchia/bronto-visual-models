import { useId, useMemo, useState } from "react";
import type { VisualTarget } from "../model.ts";
/** Explicit search-and-reveal; typing never changes authored layout or the chosen camera. */
export default function GraphFinder(props: {
  targets: readonly VisualTarget[];
  disabled: boolean;
  reveal(collection: string, id: string): Promise<void>;
  report(message: string): void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState("");
  const entries = useMemo(
    () =>
      props.targets.map((target) => ({
        target,
        key: JSON.stringify([target.collection, target.elementId, target.incarnation ?? ""]),
        search: `${target.label} ${target.collection} ${target.elementId}`.toLocaleLowerCase(),
      })),
    [props.targets],
  );
  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return entries.filter((entry) => !q || entry.search.includes(q));
  }, [entries, query]);
  const selected = matches.find((entry) => entry.key === choice) ?? matches[0];
  return (
    <details className="bvm-explore bvm-graph-find" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Find &amp; focus</summary>
      {open && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!selected || !selected.target.collection || props.disabled) return;
            void props
              .reveal(selected.target.collection, selected.target.elementId)
              .catch((e) => props.report(e instanceof Error ? e.message : String(e)));
          }}
        >
          <label htmlFor={`${id}-query`}>Find graph element</label>
          <input
            id={`${id}-query`}
            type="search"
            value={query}
            placeholder="Name or identifier"
            onChange={(e) => {
              setQuery(e.target.value);
              setChoice("");
            }}
          />
          <label htmlFor={`${id}-match`}>Matching element</label>
          <select
            id={`${id}-match`}
            value={selected?.key ?? ""}
            disabled={!matches.length}
            onChange={(e) => setChoice(e.target.value)}
          >
            {!matches.length && <option value="">No matching elements</option>}
            {matches.map(({ key, target }) => (
              <option key={key} value={key}>
                {target.label} · {target.collection === "nodes" ? "node" : "relationship"} ·{" "}
                {target.elementId}
              </option>
            ))}
          </select>
          <button type="submit" disabled={!selected || props.disabled}>
            Reveal element
          </button>
          <span role="status">
            {matches.length} of {entries.length} elements. Reveal changes only the camera and
            selection.
          </span>
        </form>
      )}
    </details>
  );
}
