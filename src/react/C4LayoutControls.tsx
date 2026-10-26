import { useState } from "react";
import type { useC4Layout } from "./useC4Layout.ts";
export default function C4LayoutControls({
  layout,
  enabled,
  blocked,
}: {
  layout: ReturnType<typeof useC4Layout>;
  enabled: boolean;
  blocked: boolean;
}) {
  const [direction, setDirection] = useState<"RIGHT" | "DOWN">("RIGHT");
  return (
    <div className="bvm-c4-layout" aria-label="Architecture layout">
      <label>
        Layout direction
        <select
          value={direction}
          disabled={!enabled || blocked || layout.locked}
          onChange={(e) => setDirection(e.target.value as "RIGHT" | "DOWN")}
        >
          <option value="RIGHT">Left to right</option>
          <option value="DOWN">Top to bottom</option>
        </select>
      </label>
      <button
        type="button"
        disabled={!enabled || blocked || layout.locked}
        onClick={() => void layout.request({ direction })}
      >
        Preview automatic layout
      </button>
      {layout.phase === "running" && (
        <>
          <span role="status">Computing a local layout; nothing saved.</span>
          <button type="button" onClick={layout.cancel}>
            Cancel layout
          </button>
        </>
      )}
      {(layout.phase === "preview" || layout.phase === "applying") && (
        <>
          <span role="status">
            Preview: {layout.proposal?.nodeCount} elements · {layout.proposal?.edgeCount}{" "}
            relationships.{" "}
            {layout.phase === "applying"
              ? "Waiting for host commit."
              : "Saved positions are unchanged."}
          </span>
          <button
            type="button"
            disabled={!enabled || blocked || layout.phase === "applying"}
            onClick={() => void layout.apply()}
          >
            Apply layout
          </button>
          <button type="button" disabled={layout.phase === "applying"} onClick={layout.discard}>
            Discard layout
          </button>
        </>
      )}
      {layout.message && <span role="status">{layout.message}</span>}
    </div>
  );
}
