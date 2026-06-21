import { useState } from 'react';
import { Github, UserRound, X } from 'lucide-react';

export function LogoBrand() {
  const [hidden, setHidden] = useState(false);

  if (hidden) {
    return (
      <div className="logo-brand-collapsed">
        <button
          className="logo-expand-btn"
          onClick={() => setHidden(false)}
          aria-label="展开 Logo"
          title="展开 Logo"
        >
          <img src="/logo.png" alt="ACG Pulse" className="logo-expand-img" />
        </button>
      </div>
    );
  }

  return (
    <div className="logo-brand glass-panel">
      <button
        className="logo-close-btn"
        onClick={() => setHidden(true)}
        aria-label="收起 Logo"
        title="收起 Logo"
      >
        <X className="h-4 w-4" />
      </button>
      <img src="/logo.png" alt="ACG Pulse" className="logo-brand-img" />
      <h1 className="logo-brand-title">ACG Pulse</h1>
      <p className="logo-brand-sub">AI 游戏情报雷达</p>
      <nav className="logo-brand-links" aria-label="项目相关链接">
        <a
          href="https://yingzhu.xyz/"
          target="_blank"
          rel="noreferrer"
          aria-label="关于我"
          title="关于我"
        >
          <UserRound className="h-4 w-4" />
        </a>
        <a
          href="https://github.com/yingzhu77/ACG-Pulse"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub 开源仓库"
          title="GitHub 开源仓库"
        >
          <Github className="h-4 w-4" />
        </a>
      </nav>
    </div>
  );
}
