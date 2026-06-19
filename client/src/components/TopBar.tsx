import { useEffect, useState } from 'react';
import { Moon, RefreshCw, Settings, Sun } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Theme, ViewMode } from '../constants';
import { formatDateTime } from '../utils/format';
import { ReportExportButton } from './ReportExportButton';

function TomatoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 7c-4.7 0-8 2.7-8 6.5C4 17.7 7.4 21 12 21s8-3.3 8-7.5C20 9.7 16.7 7 12 7Z" />
      <path d="M12 7c-1.7-2-3.7-2.6-5.5-1.8 1.7.7 2.7 1.8 3.2 3.2" />
      <path d="M12 7c1.7-2 3.7-2.6 5.5-1.8-1.7.7-2.7 1.8-3.2 3.2" />
      <path d="M12 7V3" />
    </svg>
  );
}

export interface TopBarProps {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  loading: boolean;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onRefresh: () => void;
  onOpenAdmin: () => void;
}

export function TopBar(props: TopBarProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="topbar">
      <nav className="nav-tabs" aria-label="ACG Pulse">
        <button className={props.view === 'feed' ? 'active' : ''} onClick={() => props.onViewChange('feed')}>情报总览</button>
        <button className={props.view === 'community' ? 'active' : ''} onClick={() => props.onViewChange('community')}>社区风向</button>
        <button className={props.view === 'insights' ? 'active' : ''} onClick={() => props.onViewChange('insights')}>数据洞察</button>
      </nav>

      <label className="auto-refresh-chip" title={props.autoRefresh ? '自动刷新已开启（5分钟）' : '自动刷新已关闭'}>
        <RefreshCw className={cn('h-3.5 w-3.5', props.autoRefresh && props.loading && 'spin-active')} />
        <span>自动</span>
        <input
          type="checkbox"
          checked={props.autoRefresh}
          onChange={props.onToggleAutoRefresh}
          aria-label="自动刷新"
        />
      </label>

      <div className="top-actions">
        <span className="time-chip">{formatDateTime(now.toISOString())}</span>
        <span className="status-chip">
          <span className="status-dot status-ok" />
          运行中
        </span>
        <button className="icon-button" onClick={props.onRefresh} aria-label="刷新">
          <RefreshCw className={cn('h-4 w-4', props.loading && 'spin-active')} />
        </button>
        <ReportExportButton />
        <div className="theme-switch" role="group" aria-label="主题切换">
          <button
            className={props.theme === 'light' ? 'active' : ''}
            onClick={() => props.setTheme('light')}
            aria-label="日间"
            aria-pressed={props.theme === 'light'}
            title="日间"
          >
            <Sun className="h-4 w-4" />
          </button>
          <button
            className={props.theme === 'dark' ? 'active' : ''}
            onClick={() => props.setTheme('dark')}
            aria-label="夜间"
            aria-pressed={props.theme === 'dark'}
            title="夜间"
          >
            <Moon className="h-4 w-4" />
          </button>
          <button
            className={props.theme === 'tomato' ? 'active' : ''}
            onClick={() => props.setTheme('tomato')}
            aria-label="番茄主题"
            aria-pressed={props.theme === 'tomato'}
            title="番茄主题"
          >
            <TomatoIcon className="h-4 w-4" />
          </button>
        </div>
        <button className="icon-button" onClick={props.onOpenAdmin} aria-label="设置">
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
