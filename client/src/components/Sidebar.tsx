import type { ReactNode } from 'react';
import { Bookmark, BookOpenText, ChartNoAxesColumn, Github, List, MessagesSquare, Moon, Settings, Sun, UserRound, X, Zap } from 'lucide-react';
import type { Theme, ViewMode } from '../constants';
import { followInApp, viewPaths } from '../lib/readingNavigation';
import { LogoBrand } from './LogoBrand';

const groups = [
  { title: '内容', pages: [
    { view: 'today', label: '今日精选', icon: Zap },
    { view: 'feed', label: '全部动态', icon: List },
    { view: 'daily', label: '日报', icon: BookOpenText },
    { view: 'favorites', label: '我的收藏', icon: Bookmark },
  ] },
  { title: '发现', pages: [
    { view: 'community', label: '社区风向', icon: MessagesSquare },
    { view: 'insights', label: '数据洞察', icon: ChartNoAxesColumn },
  ] },
] as const;

function TomatoIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 7c-4.7 0-8 2.7-8 6.5C4 17.7 7.4 21 12 21s8-3.3 8-7.5C20 9.7 16.7 7 12 7Z" />
    <path d="M12 7c-1.7-2-3.7-2.6-5.5-1.8 1.7.7 2.7 1.8 3.2 3.2M12 7c1.7-2 3.7-2.6 5.5-1.8-1.7.7-2.7 1.8-3.2 3.2M12 7V3" />
  </svg>;
}

interface SidebarProps {
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  onOpenAdmin: () => void;
  onClose?: () => void;
  children: ReactNode;
}

export function Sidebar({ view, onViewChange, theme, setTheme, onOpenAdmin, onClose, children }: SidebarProps) {
  return (
    <div className="workspace-rail">
      <div className="workspace-brand-row">
        <a href="/" aria-label="ACG Pulse 首页" onClick={event => followInApp(event, () => onViewChange('today'))}>
          <LogoBrand />
        </a>
        {onClose && <button className="workspace-icon" onClick={onClose} aria-label="关闭导航" autoFocus>
          <X size={19} aria-hidden="true" />
        </button>}
      </div>
      <div className="workspace-rail-scroll">
        <nav aria-label="主导航" className="workspace-navigation">
          {groups.map(({ title, pages }) => (
            <div className="workspace-nav-group" key={title}>
              <span className="workspace-nav-label">{title}</span>
              {pages.map(({ view: target, label, icon: Icon }) => (
                <a key={target} href={viewPaths[target]} aria-current={target === view ? 'page' : undefined}
                  onClick={event => followInApp(event, () => onViewChange(target))}>
                  <Icon size={18} strokeWidth={1.7} aria-hidden="true" />{label}
                </a>
              ))}
            </div>
          ))}
        </nav>
        {children}
      </div>
      <footer className="workspace-rail-foot">
        <button className="workspace-settings" onClick={onOpenAdmin} aria-label="设置">
          <Settings size={17} aria-hidden="true" />设置
        </button>
        <div className="workspace-foot-tools">
          <div className="workspace-project-links">
            <a className="workspace-icon" href="https://github.com/yingzhu77/ACG-Pulse" target="_blank"
              rel="noreferrer" aria-label="GitHub 开源仓库" title="GitHub 开源仓库"><Github size={17} /></a>
            <a className="workspace-icon" href="https://yingzhu.xyz/" target="_blank" rel="noreferrer"
              aria-label="关于我" title="关于我"><UserRound size={16} /></a>
          </div>
          <div className="workspace-themes" role="group" aria-label="主题切换">
            {([
              ['dark', '夜间', <Moon size={15} />],
              ['light', '日间', <Sun size={16} />],
              ['tomato', '番茄主题', <TomatoIcon />],
            ] as const).map(([value, label, icon]) => (
              <button key={value} title={label} aria-label={label} aria-pressed={theme === value}
                onClick={() => setTheme(value)}>{icon}</button>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
