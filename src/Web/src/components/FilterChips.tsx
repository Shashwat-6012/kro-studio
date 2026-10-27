export type Chip<T extends string> = { id: T; label: string; count?: number };

export function FilterChips<T extends string>({ items, active, onChange }: { items: Chip<T>[]; active: T; onChange: (id: T) => void }) {
  return (
    <div className="chips" role="group">
      {items.map((item) => (
        <button key={item.id} className={`chip ${active === item.id ? 'is-active' : ''}`} onClick={() => onChange(item.id)} aria-pressed={active === item.id}>
          {item.label}{item.count !== undefined && <span>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
