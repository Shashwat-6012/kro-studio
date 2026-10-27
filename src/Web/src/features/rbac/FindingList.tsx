import type { RbacFinding } from '../../api/types';

export function FindingList({ findings }: { findings: RbacFinding[] }) {
  return (
    <div className="findings">
      {findings.map((finding, index) => (
        <div className="finding" key={`${finding.identity}-${finding.check}-${index}`}>
          <span className={`finding__status finding__status--${finding.status.replace(' ', '-')}`}>{finding.status}</span>
          <div className="finding__main">
            <b>{finding.check}</b>
            <small>{finding.verb} · {finding.apiGroup || 'core'}/{finding.resource}{finding.namespace ? ` · ${finding.namespace}` : ''}</small>
            <p>{finding.detail}</p>
          </div>
          <span className="finding__source">{finding.source}</span>
        </div>
      ))}
    </div>
  );
}
