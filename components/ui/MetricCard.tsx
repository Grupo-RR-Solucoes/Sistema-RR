type MetricCardProps = {
  label: string;
  value: string;
  detail: string;
  highlight?: boolean;
};

export default function MetricCard({
  label,
  value,
  detail,
  highlight = false,
}: MetricCardProps) {
  return (
    <article className={`metric-card${highlight ? " highlight" : ""}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <span className="metric-detail">{detail}</span>
    </article>
  );
}
