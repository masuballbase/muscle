export function PhasePanel({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: string[];
}) {
  return (
    <>
      <p className="eyebrow">YOUR TRAINING JOURNAL</p>
      <h1>{title}</h1>
      <p className="muted">{subtitle}</p>
      <section className="panel">
        <span className="badge">今後の実装予定</span>
        <h2>これからできること</h2>
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="muted small">
          Phase 1では画面構成と保存・認証の基盤を用意しています。
        </p>
      </section>
    </>
  );
}
