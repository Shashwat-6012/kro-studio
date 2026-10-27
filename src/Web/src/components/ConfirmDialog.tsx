import type { ReactNode } from 'react';
import { Modal } from './Modal';

type Props = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ title, description, confirmLabel, danger, busy, onConfirm, onCancel }: Props) {
  return (
    <Modal
      title={title}
      width={460}
      busy={busy}
      onClose={onCancel}
      footer={<>
        <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={`btn ${danger ? 'btn--danger-solid' : 'btn--primary'}`} onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
      </>}
    >
      <div className="confirm-copy">{description}</div>
    </Modal>
  );
}
