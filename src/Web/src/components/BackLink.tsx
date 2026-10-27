import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export function BackLink({ to, label, current }: { to: string; label: string; current: string }) {
  return <div className="back-link"><Link to={to}><ArrowLeft size={14} /> {label}</Link><span>/</span><b>{current}</b></div>;
}
