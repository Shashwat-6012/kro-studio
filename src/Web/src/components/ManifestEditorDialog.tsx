import { useMemo, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Modal } from './Modal';
import { parseManifest } from '../lib/yaml';

type Props = {
  kicker: string;
  title: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onClose: () => void;
  /** Optional server-side check (RGD dry run). */
  onValidate?: () => void;
  validateLabel?: string;
  serverError?: string | null;
  serverNotice?: string | null;
  hint?: ReactNode;
};

/** Shared YAML editor dialog with live syntax feedback, Tab indentation and Ctrl/Cmd+Enter to submit. */
export function ManifestEditorDialog(props: Props) {
  const { value, onChange, busy, onSubmit, onValidate } = props;
  const parsed = useMemo(() => parseManifest(value), [value]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      const el = event.currentTarget;
      const next = `${value.slice(0, el.selectionStart)}  ${value.slice(el.selectionEnd)}`;
      const caret = el.selectionStart + 2;
      onChange(next);
      requestAnimationFrame(() => el.setSelectionRange(caret, caret));
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !busy && !parsed.error) onSubmit();
  };

  return (
    <Modal
      title={props.title}
      kicker={props.kicker}
      description={props.description}
      width={780}
      busy={busy}
      onClose={props.onClose}
      footer={<>
        <span className="editor-status">
          {parsed.error
            ? <span className="editor-status__error"><AlertTriangle size={14} />{parsed.error}</span>
            : <span className="editor-status__ok"><CheckCircle2 size={14} />Valid YAML</span>}
        </span>
        {onValidate && <button className="btn" onClick={onValidate} disabled={busy || Boolean(parsed.error)}><ShieldCheck size={15} />{busy ? 'Working…' : props.validateLabel ?? 'Validate'}</button>}
        <button className="btn btn--primary" onClick={onSubmit} disabled={busy || Boolean(parsed.error)}><ArrowRight size={15} />{busy ? 'Saving…' : props.submitLabel}</button>
      </>}
    >
      <textarea className="yaml-editor" spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} aria-label="Manifest editor" />
      {props.serverError && <div className="callout callout--danger"><AlertTriangle size={15} /><span>{props.serverError}</span></div>}
      {props.serverNotice && <div className="callout callout--success"><CheckCircle2 size={15} /><span>{props.serverNotice}</span></div>}
      <div className="editor-hint"><ShieldCheck size={14} />{props.hint ?? 'Press Ctrl/Cmd + Enter to save.'}</div>
    </Modal>
  );
}
