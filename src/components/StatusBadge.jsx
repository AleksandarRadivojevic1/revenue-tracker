import { STATUS_META } from '../format.js';

export default function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.upcoming;
  return (
    <span className={`pill ${meta.tone}`}>
      <span className="dot" />
      {meta.label}
    </span>
  );
}
