import type { ReactNode } from 'react';

export const metadata = {
  title: 'DTG Product Engine',
  description: 'Design To Go — catalog identity, configuration and pricing.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
