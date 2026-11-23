import { useEffect, useState } from 'react';
import { CalendarDays, Menu, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatDateTime } from '../utils/format';
import { LogoBrand } from './LogoBrand';
import { ReportExportButton } from './ReportExportButton';

interface TopBarProps {
  loading: boolean;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onRefresh: () => void;
  onOpenDaily: () => void;
  onOpenNavigation?: () => void;
}

export function TopBar(props: TopBarProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="workspace-toolbar">
      {props.onOpenNavigation ? (
        <div className="workspace-mobile-heading">
          <button className="workspace-icon" onClick={props.onOpenNavigation} aria-label="打开导航"
            aria-haspopup="dialog" aria-controls="navigation-drawer"><Menu size={20} aria-hidden="true" /></button>
          <LogoBrand />
        </div>
      ) : (
        <time className="workspace-clock" dateTime={now.toISOString()}>
          <CalendarDays size={15} aria-hidden="true" />{formatDateTime(now.toISOString())}
        </time>
      )}
      <div className="workspace-tools">
        <button className="workspace-auto" onClick={props.onToggleAutoRefresh} aria-label="自动刷新"
          aria-pressed={props.autoRefresh} title={props.autoRefresh ? '自动刷新已开启（5分钟）' : '自动刷新已关闭'}>
          <span className="workspace-auto-dot" aria-hidden="true" />自动刷新
        </button>
        <button className="workspace-icon" onClick={props.onRefresh} aria-label="刷新" title="刷新">
          <RefreshCw size={16} aria-hidden="true" className={cn(props.loading && 'spin-active')} />
        </button>
        <ReportExportButton now={now} onOpenDaily={props.onOpenDaily} />
      </div>
    </header>
  );
}
