import { Search } from 'lucide-react';

export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (value: string) => void; placeholder?: string; className?: string }) {
  return (
    <label className={`search-input ${className ?? ''}`}>
      <Search size={15} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}
