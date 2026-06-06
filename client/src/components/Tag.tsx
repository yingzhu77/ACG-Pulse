import { cn } from '../lib/utils';

export function Tag({ children, tone = 'default' }: { children: React.ReactNode; tone?: string }) {
  return <span className={cn('tag', `tag-${tone}`)}>{children}</span>;
}
