import AdminSettingsPage from './settings-page';

// Read MCP_PUBLIC_URL per request: acc and prod share one image, so it must not be baked at build.
export const dynamic = 'force-dynamic';

export default function Page() {
  return <AdminSettingsPage mcpUrl={process.env.MCP_PUBLIC_URL || undefined} />;
}
