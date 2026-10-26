import { useState } from 'react';
import { Check, Clipboard, FileCode2 } from 'lucide-react';
import { toYaml } from '../lib/yaml';

type Props = { title: string; value: unknown; empty?: string; maxHeight?: number; bare?: boolean };

/** Read-only YAML viewer with copy button. */
export function CodePanel({ title, value, empty = 'Nothing to show.', maxHeight, bare }: Props) {
  const [copied, setCopied] = useState(false);
  const text = value ? toYaml(value) : '';
  const copy = async () => {
    await navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className={`code-panel ${bare ? 'code-panel--bare' : ''}`}>
      <div className="code-panel__bar">
        <span><FileCode2 size={14} />{title}</span>
        <button onClick={() => void copy()} disabled={!value}>{copied ? <Check size={13} /> : <Clipboard size={13} />}{copied ? 'Copied' : 'Copy'}</button>
      </div>
      {value ? <pre style={maxHeight ? { maxHeight } : undefined}>{text}</pre> : <div className="inline-empty">{empty}</div>}
    </div>
  );
}
