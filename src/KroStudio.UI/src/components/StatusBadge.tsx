import { toneOf, type Tone } from '../lib/status';
import { cx } from '../lib/format';

export function StatusBadge({ status, tone, compact }: { status: string; tone?: Tone; compact?: boolean }) {
  return <span className={cx('badge', `badge--${tone ?? toneOf(status)}`, compact && 'badge--compact')}><i />{status}</span>;
}
