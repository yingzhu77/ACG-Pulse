import { cn } from '../lib/utils';

export function SummaryMetric({ label, value, suffix = '', note, tone }: { label: string; value: number; suffix?: string; note: string; tone: string }) {
  return (
    <div className={cn('summary-metric', tone)}>
      <span>{label}</span>
      <b>{value}{suffix}</b>
      <em>{note}</em>
    </div>
  );
}
