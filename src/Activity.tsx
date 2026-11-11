import { useActivity } from "./store.ts";

/** Floating corner indicator for in-flight requests and background errors. */
export function ActivityIndicator() {
  const { activities, toasts } = useActivity();
  if (!activities.length && !toasts.length) return null;
  const labels = [...new Set(activities.map((a) => a.label))];
  return (
    <div className="activity">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
      {labels.length > 0 && (
        <div className="spinner-row" title={labels.join("\n")}>
          <span className="spinner" />
          {labels.length === 1 ? labels[0] : `${labels[0]} 等 ${labels.length} 项`}
        </div>
      )}
    </div>
  );
}
