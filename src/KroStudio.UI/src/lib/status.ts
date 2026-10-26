export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

export const TONE_COLORS: Record<Tone, string> = {
  success: '#46ac80',
  warning: '#d9a34c',
  danger: '#d2605f',
  neutral: '#b5b8c4',
};

const SUCCESS = new Set(['ready', 'active', 'succeeded', 'complete', 'created', 'available', 'healthy', 'normal', 'true', 'running']);
const DANGER = new Set(['failed', 'error', 'degraded', 'crashloopbackoff', 'imagepullbackoff', 'errimagepull', 'oomkilled', 'createcontainerconfigerror', 'evicted', 'failure', 'deadlineexceeded']);
const WARNING = new Set(['processing', 'pending', 'in_progress', 'inprogress', 'progressing', 'warning', 'inactive', 'terminating', 'unknown', 'deleting']);

/**
 * Single place that maps a status label to a visual tone.
 * Add new KRO / Kubernetes states here (e.g. how "Inactive" should look).
 */
export function toneOf(status: string): Tone {
  const key = status.toLowerCase().replace(/[\s-]/g, '');
  if (SUCCESS.has(key)) return 'success';
  if (DANGER.has(key) || key.includes('fail') || key.includes('error')) return 'danger';
  if (WARNING.has(key)) return 'warning';
  return 'neutral';
}
