import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem', lineHeight: 1.5 }}>
      <h1>DTG Product Engine</h1>
      <p>STEP 06 · Admin MVP / Review Console. No public catalog and no CRM integration yet.</p>
      <p>
        <Link href="/admin">Abrir el Admin</Link> · Health: <code>/api/v1/health</code>
      </p>
    </main>
  );
}
