interface SentimentTrendMiniProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function SentimentTrendMini({ data, width = 120, height = 32, color = 'var(--pink)' }: SentimentTrendMiniProps) {
  if (data.length < 2) return null;

  const max = Math.max(...data, 1);
  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - (v / max) * (height - 4) - 2,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = pathD + ` L ${width} ${height} L 0 ${height} Z`;
  const gradId = `miniGrad-${color.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <svg width={width} height={height} className="sentiment-trend-mini">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
