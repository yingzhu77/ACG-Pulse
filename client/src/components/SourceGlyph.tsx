import { sourceNames } from '../constants';
import { SourceIcon } from './SourceIcon';

export function SourceGlyph({ type }: { type: string }) {
  return (
    <div className="source-glyph">
      <SourceIcon type={type} />
      <span>{sourceNames[type] || '来源'}</span>
    </div>
  );
}
