export const metadata = {
  title: 'RR Comissões',
  description: 'Sistema de produção e comissões',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          fontFamily: 'Arial, sans-serif',
          background: '#f4f6f8',
        }}
      >
        {children}
      </body>
    </html>
  );
}
