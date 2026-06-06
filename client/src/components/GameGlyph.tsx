import { useState } from 'react';
import { Gamepad2 } from 'lucide-react';

export function GameGlyph({ label, accent, iconUrl, fallbackIcon }: { label: string; accent: string; iconUrl?: string; fallbackIcon?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="game-glyph" style={{ '--accent': accent } as React.CSSProperties}>
      {iconUrl && !failed ? (
        <img src={iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : fallbackIcon && !label ? (
        <Gamepad2 className="h-4 w-4" />
      ) : (
        label
      )}
    </span>
  );
}
