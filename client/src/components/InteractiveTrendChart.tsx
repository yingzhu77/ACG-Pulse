import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '../lib/utils';

export interface TrendChartDatum {
  label: string;
  value: number;
  detail?: string;
}

interface InteractiveTrendChartProps {
  title: string;
  data: TrendChartDatum[];
  valueLabel: string;
  unit?: string;
  color: string;
  compact?: boolean;
  headingLevel?: 3 | 4;
  edgeLabels?: [string, string];
  emptyText?: string;
}

const PLOT_LEFT = 8;
const PLOT_WIDTH = 90;
const PLOT_TOP = 12;
const PLOT_BOTTOM = 88;

function signedValue(value: number, unit: string) {
  if (value === 0) return '持平';
  return `${value > 0 ? '+' : ''}${value}${unit}`;
}

export function InteractiveTrendChart({
  title,
  data,
  valueLabel,
  unit = '',
  color,
  compact = false,
  headingLevel = 3,
  edgeLabels,
  emptyText = '暂无趋势数据',
}: InteractiveTrendChartProps) {
  const gradientId = useId().replace(/:/g, '');
  const liveRegionId = `${gradientId}-live`;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const latestIndex = Math.max(data.length - 1, 0);
  const selectedIndex = activeIndex === null ? latestIndex : Math.min(activeIndex, latestIndex);
  const latest = data[latestIndex];
  const previous = data[Math.max(latestIndex - 1, 0)];
  const peak = data.reduce((max, item) => Math.max(max, item.value), 0);
  const delta = latest && previous ? latest.value - previous.value : 0;
  const maxValue = Math.max(peak, 1);

  const points = useMemo(() => data.map((item, index) => ({
    x: data.length === 1 ? 50 : PLOT_LEFT + (index / (data.length - 1)) * PLOT_WIDTH,
    y: PLOT_BOTTOM - (item.value / maxValue) * (PLOT_BOTTOM - PLOT_TOP),
  })), [data, maxValue]);

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const area = path ? `${path} L ${points.at(-1)?.x ?? PLOT_LEFT} ${PLOT_BOTTOM} L ${points[0]?.x ?? PLOT_LEFT} ${PLOT_BOTTOM} Z` : '';

  const tickIndexes = useMemo(() => {
    if (data.length === 0) return [];
    if (edgeLabels) return data.length === 1 ? [0] : [0, data.length - 1];
    const tickCount = Math.min(6, data.length);
    return Array.from(new Set(Array.from({ length: tickCount }, (_, index) => (
      Math.round((index / Math.max(tickCount - 1, 1)) * (data.length - 1))
    ))));
  }, [data.length, edgeLabels]);

  const selectFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (data.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const rawRatio = (event.clientX - bounds.left) / Math.max(bounds.width, 1);
    const plotRatio = Math.max(0, Math.min(1, (rawRatio - PLOT_LEFT / 100) / (PLOT_WIDTH / 100)));
    setActiveIndex(Math.round(plotRatio * (data.length - 1)));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    selectFromPointer(event);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (data.length === 0) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setActiveIndex(index => Math.max(0, (index ?? latestIndex) - 1));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setActiveIndex(index => Math.min(data.length - 1, (index ?? latestIndex) + 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(data.length - 1);
    }
  };

  const Heading = headingLevel === 4 ? 'h4' : 'h3';
  const activePoint = points[selectedIndex];
  const activeDatum = data[selectedIndex];
  const tooltipEdge = activePoint?.x < 20 ? 'edge-left' : activePoint?.x > 80 ? 'edge-right' : '';

  return (
    <div className={cn('interactive-trend', compact && 'compact')}>
      <div className="trend-card-heading">
        <Heading>{title}</Heading>
        {latest && (
          <div className="trend-kpis" aria-label={`${title}摘要`}>
            <span><small>最新</small><b>{latest.value}{unit}</b></span>
            <span><small>峰值</small><b>{peak}{unit}</b></span>
            <span><small>较上点</small><b className={cn(delta > 0 && 'trend-up', delta < 0 && 'trend-down')}>{signedValue(delta, unit)}</b></span>
          </div>
        )}
      </div>

      {data.length === 0 ? (
        <div className="trend-empty">{emptyText}</div>
      ) : (
        <>
          <div className="trend-plot-grid">
            <div className="trend-y-axis" aria-hidden="true">
              <span>{peak}</span>
              <span>{Math.round(peak / 2)}</span>
              <span>0</span>
            </div>
            <div
              className="trend-interaction"
              role="group"
              tabIndex={0}
              aria-label={`${title}，使用左右方向键查看数据点`}
              aria-describedby={liveRegionId}
              onPointerMove={selectFromPointer}
              onPointerDown={handlePointerDown}
              onPointerLeave={() => setActiveIndex(null)}
              onKeyDown={handleKeyDown}
              onFocus={() => setActiveIndex(null)}
            >
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="trend-svg" aria-hidden="true">
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                    <stop offset="100%" stopColor={color} stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                {[PLOT_TOP, 50, PLOT_BOTTOM].map(y => (
                  <line key={y} x1={PLOT_LEFT} x2={PLOT_LEFT + PLOT_WIDTH} y1={y} y2={y} className="trend-gridline" />
                ))}
                <path d={area} fill={`url(#${gradientId})`} />
                <path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
              </svg>

              {activePoint && activeDatum && (
                <>
                  <span className="trend-crosshair" style={{ left: `${activePoint.x}%` }} aria-hidden="true" />
                  <span
                    className="trend-active-dot"
                    style={{ left: `${activePoint.x}%`, top: `${activePoint.y}%`, background: color, color }}
                    aria-hidden="true"
                  />
                  <div
                    className={cn('trend-tooltip', tooltipEdge, activePoint.y < 34 && 'below')}
                    style={{ left: `${activePoint.x}%`, top: `${activePoint.y}%` }}
                    aria-hidden="true"
                  >
                    <strong>{activeDatum.label}</strong>
                    <span>{valueLabel} {activeDatum.value}{unit}{activeDatum.detail ? ` · ${activeDatum.detail}` : ''}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="trend-x-axis" aria-hidden="true">
            {tickIndexes.map((dataIndex, tickIndex) => (
              <span key={dataIndex}>
                {edgeLabels ? (data.length === 1 ? edgeLabels[1] : edgeLabels[tickIndex]) : data[dataIndex].label}
              </span>
            ))}
          </div>
          <span id={liveRegionId} className="sr-only" aria-live="polite">
            {activeDatum ? `${activeDatum.label}，${valueLabel} ${activeDatum.value}${unit}${activeDatum.detail ? `，${activeDatum.detail}` : ''}` : emptyText}
          </span>
        </>
      )}
    </div>
  );
}
