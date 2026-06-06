import { useEffect, useState } from 'react';
import { Moon, Radio, RefreshCw, Settings, Sun } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Theme } from '../constants';
import { formatDateTime } from '../utils/format';

export interface TopBarProps {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  loading: boolean;
  view: 'feed' | 'insights';
  onViewChange: (view: 'feed' | 'insights') => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onRefresh: () => void;
  onOpenAdmin: () => void;
}

export function TopBar(props: TopBarProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark">
          <Radio className="h-6 w-6" />
        </div>
        <div>
          <h1>Game Pulse</h1>
          <p>游戏情报雷达</p>
        </div>
      </div>

      <nav className="nav-tabs" aria-label="Game Pulse">
        <button className={props.view === 'feed' ? 'active' : ''} onClick={() => props.onViewChange('feed')}>情报总览</button>
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
        <div className="theme-switch" aria-label="主题切换">
          <button className={props.theme === 'light' ? 'active' : ''} onClick={() => props.setTheme('light')} aria-label="日间">
            <Sun className="h-4 w-4" />
            日间
          </button>
          <button className={props.theme === 'dark' ? 'active' : ''} onClick={() => props.setTheme('dark')} aria-label="夜间">
            <Moon className="h-4 w-4" />
            夜间
          </button>
        </div>
        <button className="icon-button" onClick={props.onOpenAdmin} aria-label="设置">
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
