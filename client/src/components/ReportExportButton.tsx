import { useRef, useState } from 'react';
import { Download, FileText, Calendar } from 'lucide-react';
import { publicApi } from '../services/api';

const shanghaiDay = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' });

export function ReportExportButton({ onOpenDaily, now }: { onOpenDaily: () => void; now: Date }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const today = shanghaiDay.format(now);
  const weekStart = shanghaiDay.format(new Date(now.getTime() - 6 * 86_400_000));
  return (
    <div className="export-btn-wrap"
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={event => {
        if (open && event.key === 'Escape') {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}>
      <button type="button" ref={trigger} className="export-btn-trigger" onClick={() => setOpen(!open)}
        aria-expanded={open} aria-label="导出报告">
        <Download className="h-3.5 w-3.5" />
        导出报告
      </button>
      {open && (
        <>
          <div className="export-btn-overlay" onClick={() => setOpen(false)} />
          <div className="export-btn-dropdown">
            <button type="button" className="export-btn-item" onClick={() => { setOpen(false); onOpenDaily(); }}>
              <FileText className="h-4 w-4 export-icon-blue" />
              <div><div className="export-btn-label">日报存档</div><div className="export-btn-date">选择已出刊的日期后导出</div></div>
            </button>
            <a className="export-btn-item" href={publicApi.exportReportUrl({ type: 'weekly' })}
              target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
              <Calendar className="h-4 w-4 export-icon-green" />
              <div><div className="export-btn-label">本周周报 (Markdown)</div><div className="export-btn-date">{weekStart} ~ {today}</div></div>
            </a>
          </div>
        </>
      )}
    </div>
  );
}
