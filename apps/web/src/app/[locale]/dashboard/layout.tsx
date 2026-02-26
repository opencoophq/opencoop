'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { AdminProvider, useAdmin } from '@/contexts/admin-context';
import {
  LayoutDashboard,
  FileText,
  ArrowLeftRight,
  Coins,
  FileDown,
  Settings,
  Users,
  Building2,
  CreditCard,
  Upload,
  Palette,
  Shield,
  ChevronDown,
  LogOut,
  Menu,
  X,
  BarChart3,
  UserCog,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

function DashboardContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations();
  const { selectedCoop, adminCoops, setSelectedCoop, setAdminCoops } = useAdmin();
  const [user, setUser] = useState<{ email: string; name?: string; role: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [adminStats, setAdminStats] = useState<{
    pendingTransactions: number;
    pendingShareholders: number;
    unmatchedBankTransactions: number;
  } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const userData = localStorage.getItem('user');

    if (!token || !userData) {
      router.push('/login');
      return;
    }

    try {
      const parsed = JSON.parse(userData);
      setUser(parsed);

      // Load admin coops if admin
      if (parsed.role === 'COOP_ADMIN' || parsed.role === 'SYSTEM_ADMIN') {
        fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.adminCoops) {
              setAdminCoops(data.adminCoops);
              if (data.adminCoops.length > 0 && !selectedCoop) {
                setSelectedCoop(data.adminCoops[0]);
              }
            }
          })
          .catch(() => {});
      }
    } catch {
      router.push('/login');
    }
  }, []);

  // Fetch admin stats for attention dots
  useEffect(() => {
    if (!selectedCoop) return;
    const token = localStorage.getItem('accessToken');
    if (!token) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/admin/coops/${selectedCoop.id}/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setAdminStats(data);
      })
      .catch(() => {});
  }, [selectedCoop]);

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    router.push('/login');
  };

  const isAdmin = user?.role === 'COOP_ADMIN' || user?.role === 'SYSTEM_ADMIN';
  const isSystemAdmin = user?.role === 'SYSTEM_ADMIN';

  const shareholderNav: NavItem[] = [
    { href: '/dashboard', label: t('common.overview'), icon: <LayoutDashboard className="h-4 w-4" /> },
    { href: '/dashboard/shares', label: t('shares.title'), icon: <FileText className="h-4 w-4" /> },
    { href: '/dashboard/transactions', label: t('transactions.title'), icon: <ArrowLeftRight className="h-4 w-4" /> },
    { href: '/dashboard/dividends', label: t('dividends.title'), icon: <Coins className="h-4 w-4" /> },
    { href: '/dashboard/documents', label: t('common.documents'), icon: <FileDown className="h-4 w-4" /> },
    { href: '/dashboard/personal-data', label: t('personalData.title'), icon: <UserCog className="h-4 w-4" /> },
    { href: '/dashboard/settings', label: t('common.settings'), icon: <Settings className="h-4 w-4" /> },
  ];

  const adminNav: NavItem[] = selectedCoop
    ? [
        { href: '/dashboard/admin', label: t('common.overview'), icon: <LayoutDashboard className="h-4 w-4" /> },
        { href: '/dashboard/admin/shareholders', label: t('admin.shareholders.title'), icon: <Users className="h-4 w-4" />, badge: adminStats?.pendingShareholders },
        { href: '/dashboard/admin/share-classes', label: t('admin.shareClasses.title'), icon: <FileText className="h-4 w-4" /> },
        { href: '/dashboard/admin/transactions', label: t('transactions.title'), icon: <ArrowLeftRight className="h-4 w-4" />, badge: adminStats?.pendingTransactions },
        { href: '/dashboard/admin/projects', label: t('admin.projects.title'), icon: <Building2 className="h-4 w-4" /> },
        { href: '/dashboard/admin/dividends', label: t('dividends.title'), icon: <Coins className="h-4 w-4" /> },
        { href: '/dashboard/admin/bank-import', label: t('admin.bankImport.title'), icon: <Upload className="h-4 w-4" />, badge: adminStats?.unmatchedBankTransactions },
        { href: '/dashboard/admin/reports', label: t('reports.title'), icon: <BarChart3 className="h-4 w-4" /> },
        { href: '/dashboard/admin/settings', label: t('common.settings'), icon: <Settings className="h-4 w-4" /> },
        { href: '/dashboard/admin/branding', label: t('admin.branding.title'), icon: <Palette className="h-4 w-4" /> },
      ]
    : [];

  const systemNav: NavItem[] = isSystemAdmin
    ? [
        { href: '/dashboard/system', label: t('common.overview'), icon: <Shield className="h-4 w-4" /> },
        { href: '/dashboard/system/coops', label: t('system.coops.title'), icon: <Building2 className="h-4 w-4" /> },
        { href: '/dashboard/system/users', label: t('system.users.title'), icon: <Users className="h-4 w-4" /> },
      ]
    : [];

  const renderNavSection = (title: string, items: NavItem[]) => (
    <div className="mb-6">
      <h3 className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {title}
      </h3>
      <nav className="space-y-1">
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground/70 hover:bg-accent'
              }`}
              onClick={() => setSidebarOpen(false)}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {!!item.badge && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1.5 text-[11px] font-medium text-white">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/50">
      {/* Mobile menu button */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-card border-b px-4 py-3 flex items-center justify-between">
        <span className="font-semibold text-lg">OpenCoop</span>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-card border-r transform transition-transform lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          <div className="p-4 border-b">
            <h1 className="text-xl font-bold text-primary">OpenCoop</h1>
          </div>

          {/* Coop selector for admins */}
          {isAdmin && adminCoops.length > 0 && (
            <div className="p-3 border-b">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between text-sm">
                    {selectedCoop?.name || 'Select coop'}
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  {adminCoops.map((coop) => (
                    <DropdownMenuItem key={coop.id} onClick={() => setSelectedCoop(coop)}>
                      {coop.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          <div className="flex-1 overflow-y-auto py-4 px-2">
            {!isAdmin && renderNavSection(t('common.myAccount'), shareholderNav)}
            {isAdmin && adminNav.length > 0 && renderNavSection(t('admin.title'), adminNav)}
            {isSystemAdmin && renderNavSection(t('system.title'), systemNav)}
          </div>

          {/* Language & theme controls */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-2 border-t">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>

          {/* User info + logout */}
          <div className="p-3 border-t">
            <div className="flex items-center justify-between">
              <Link href="/dashboard/settings" className="text-sm truncate min-w-0 hover:opacity-80">
                {user.name ? (
                  <>
                    <p className="font-medium truncate">{user.name}</p>
                    <p className="text-muted-foreground text-xs truncate">{user.email}</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium truncate">{user.email}</p>
                    <p className="text-muted-foreground text-xs">{t(`system.users.roles.${user.role}`)}</p>
                  </>
                )}
              </Link>
              <Button variant="ghost" size="icon" onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="lg:pl-64 pt-14 lg:pt-0">
        {selectedCoop && selectedCoop.active === false && (
          <div className="px-6 pt-6">
            <Alert className="border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-200">
              <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              <AlertDescription>{t('onboarding.pendingActivation')}</AlertDescription>
            </Alert>
          </div>
        )}
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminProvider>
      <DashboardContent>{children}</DashboardContent>
    </AdminProvider>
  );
}
