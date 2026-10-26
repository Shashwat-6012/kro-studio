export type TabItem<T extends string> = { id: T; label: string; count?: number };

export function Tabs<T extends string>({ items, active, onChange }: { items: TabItem<T>[]; active: T; onChange: (id: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button key={item.id} role="tab" aria-selected={active === item.id} className={`tabs__tab ${active === item.id ? 'is-active' : ''}`} onClick={() => onChange(item.id)}>
          {item.label}{item.count !== undefined && <span className="tabs__count">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
