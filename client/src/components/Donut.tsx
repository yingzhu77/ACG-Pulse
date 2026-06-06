import { categoriesLabel } from '../utils/format';

export function Donut({ counts, tones = ['#6d8cff', '#ff5b8a', '#f6a03d', '#4ecf98', '#45c4ff'], labelFor = categoriesLabel }: { counts: Record<string, number>; tones?: string[]; labelFor?: (value: string) => string }) {
  const entries = Object.entries(counts).filter(([, value]) => value > 0).slice(0, 5);
  const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1;
  let cursor = 0;
  const segments = entries.map(([, value], index) => {
    const start = cursor;
    cursor += (value / total) * 100;
    return `${tones[index % tones.length]} ${start}% ${cursor}%`;
  });
  return (
    <div className="donut-wrap">
      <div className="donut" style={{ background: `conic-gradient(${segments.join(', ') || '#6d8cff 0 100%'})` }} />
      <div className="donut-legend">
        {entries.map(([key, value], index) => (
          <span key={key}>
            <i style={{ background: tones[index % tones.length] }} />
            {labelFor(key)} {value}
          </span>
        ))}
      </div>
    </div>
  );
}
