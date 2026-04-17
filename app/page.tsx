import DailyImportClient from '../components/DailyImportClient';

export default function Home() {
  return (
    <main
      style={{
        background: '#f3f5f9',
        minHeight: '100vh',
        padding: '32px 24px',
      }}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gap: 24 }}>
        <header>
          <div style={{ fontSize: 14, color: '#556070', marginBottom: 8 }}>
            Protótipo inicial para produção e acompanhamento
          </div>
          <h1 style={{ margin: 0, fontSize: 34 }}>RR Comissões</h1>
        </header>

        <DailyImportClient />
      </div>
    </main>
  );
}
