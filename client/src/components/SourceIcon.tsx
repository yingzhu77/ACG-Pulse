import { useState } from 'react';
import { Activity, Globe2, Radio, Video } from 'lucide-react';
import { sourceIconUrls } from '../constants';

export function SourceIcon({ type }: { type: string }) {
  const [failed, setFailed] = useState(false);
  const iconUrl = sourceIconUrls[type];
  if (iconUrl && !failed) {
    return (
      <span className="source-logo-img">
        <img src={iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </span>
    );
  }
  if (type === 'bilibili_video') return <Video className="h-4 w-4" />;
  if (type === 'official_site') return <Globe2 className="h-4 w-4" />;
  if (type === 'trend') return <Activity className="h-4 w-4" />;
  return <Radio className="h-4 w-4" />;
}
