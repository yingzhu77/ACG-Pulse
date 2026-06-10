interface HeatScoreRingProps {
  score: number;
  size?: number;
}

export function HeatScoreRing({ score, size = 44 }: HeatScoreRingProps) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? 'var(--pink)' : score >= 50 ? 'var(--orange)' : 'var(--green)';

  return (
    <svg width={size} height={size} className="heat-score-ring">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--stroke)"
        strokeWidth={3}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--text-strong)"
        fontSize={size * 0.28}
        fontWeight={800}
      >
        {score}
      </text>
    </svg>
  );
}
