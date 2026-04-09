'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { AdminProvider, useAdmin } from '@/contexts/admin-context';
import { PermissionsProvider, usePermissions } from '@/contexts/permissions-context';
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
  Shield,
  History,
  ChevronDown,
  LogOut,
  Menu,
  X,
  BarChart3,
  UserCog,
  Mail as MailIcon,
  Loader2,
  BookOpen,
  Layers,
  UserPlus,
  Megaphone,
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
import { FeedbackButton } from '@/components/feedback-button';
import { api, resolveLogoUrl } from '@/lib/api';
import { getAllSessions, switchSession, removeSession, getActiveSessionId, clearAllSessions, type Session } from '@/lib/sessions';

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
  const { hasPermission } = usePermissions();
  const [user, setUser] = useState<{ email: string; name?: string; role: string; emailVerified?: boolean } | null>(null);
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [verificationResent, setVerificationResent] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [savedSessions, setSavedSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [adminStats, setAdminStats] = useState<{
    pendingRegistrations: number;
    pendingShareholders: number;
    unmatchedBankTransactions: number;
  } | null>(null);
  const [shareholderCoop, setShareholderCoop] = useState<{ name: string; logoUrl?: string } | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

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
      setSavedSessions(getAllSessions());
      setActiveSessionId(getActiveSessionId());

      // Always fetch profile to get emailVerified status
      api<{
        emailVerified?: boolean;
        adminCoops?: typeof adminCoops;
        shareholderCoops?: Array<{ name: string; logoUrl?: string }>;
        shareholders?: Array<{ id: string }>;
      }>('/auth/me')
        .then((data) => {
          setEmailVerified(data.emailVerified ?? true);

          if (data.adminCoops) {
            setAdminCoops(data.adminCoops);
            if (data.adminCoops.length > 0 && !selectedCoop) {
              setSelectedCoop(data.adminCoops[0]);
            }
          }

          if (data.shareholderCoops?.length) {
            setShareholderCoop(data.shareholderCoops[0]);
          }

          // Fetch unread message count for shareholder inbox badge
          if (data.shareholders?.[0]) {
            api<{ count: number }>(`/shareholders/${data.shareholders[0].id}/unread-count`)
              .then((res) => setUnreadCount(res.count))
              .catch(() => {});
          }
        })
        .catch(() => {});
    } catch {
      router.push('/login');
    }
  }, []);

  // Fetch admin stats for attention dots
  useEffect(() => {
    if (!selectedCoop) return;
    api<typeof adminStats>(`/admin/coops/${selectedCoop.id}/stats`)
      .then((data) => {
        if (data) setAdminStats(data);
      })
      .catch(() => {});
  }, [selectedCoop]);

  const handleLogout = () => {
    api('/auth/logout', { method: 'POST' }).catch(() => {});
    if (activeSessionId) removeSession(activeSessionId);
    const remaining = getAllSessions();
    if (remaining.length > 0) {
      switchSession(remaining[0].id);
      window.location.href = '/dashboard';
    } else {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      clearAllSessions();
      window.location.href = '/login';
    }
  };

  const handleSwitchSession = (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    switchSession(sessionId);
    window.location.href = '/dashboard';
  };

  const isAdmin = user?.role === 'COOP_ADMIN' || user?.role === 'SYSTEM_ADMIN';
  const isSystemAdmin = user?.role === 'SYSTEM_ADMIN';

  // Resolve the coop branding to show in the sidebar
  const activeCoop = selectedCoop || shareholderCoop;
  const rawLogoUrl = activeCoop && 'logoUrl' in activeCoop ? activeCoop.logoUrl : undefined;
  const coopLogoUrl = resolveLogoUrl(rawLogoUrl) ?? undefined;
  const coopName = activeCoop?.name;

  const shareholderNav: NavItem[] = [
    { href: '/dashboard', label: t('common.overview'), icon: <LayoutDashboard className="h-4 w-4" /> },
    { href: '/dashboard/shares', label: t('shares.title'), icon: <FileText className="h-4 w-4" /> },
    { href: '/dashboard/transactions', label: t('transactions.title'), icon: <ArrowLeftRight className="h-4 w-4" /> },
    { href: '/dashboard/dividends', label: t('dividends.title'), icon: <Coins className="h-4 w-4" /> },
    { href: '/dashboard/documents', label: t('common.documents'), icon: <FileDown className="h-4 w-4" /> },
    { href: '/dashboard/inbox', label: t('messages.title'), icon: <MailIcon className="h-4 w-4" />, badge: unreadCount },
    { href: '/dashboard/personal-data', label: t('personalData.title'), icon: <UserCog className="h-4 w-4" /> },
    { href: '/dashboard/settings', label: t('common.settings'), icon: <Settings className="h-4 w-4" /> },
  ];

  const adminNav: NavItem[] = selectedCoop
    ? ([
        { href: '/dashboard/admin', label: t('common.overview'), icon: <LayoutDashboard className="h-4 w-4" /> },
        hasPermission('canManageShareholders') && { href: '/dashboard/admin/shareholders', label: t('admin.shareholders.title'), icon: <Users className="h-4 w-4" />, badge: adminStats?.pendingShareholders },
        hasPermission('canManageShareClasses') && { href: '/dashboard/admin/share-classes', label: t('admin.shareClasses.title'), icon: <FileText className="h-4 w-4" /> },
        hasPermission('canManageTransactions') && { href: '/dashboard/admin/transactions', label: t('transactions.title'), icon: <ArrowLeftRight className="h-4 w-4" />, badge: adminStats?.pendingRegistrations },
        hasPermission('canManageProjects') && { href: '/dashboard/admin/projects', label: t('admin.projects.title'), icon: <Building2 className="h-4 w-4" /> },
        hasPermission('canManageDividends') && { href: '/dashboard/admin/dividends', label: t('dividends.title'), icon: <Coins className="h-4 w-4" /> },
        hasPermission('canManageMessages') && { href: '/dashboard/admin/messages', label: t('messages.title'), icon: <MailIcon className="h-4 w-4" /> },
        hasPermission('canManageTransactions') && { href: '/dashboard/admin/bank-import', label: t('admin.bankImport.title'), icon: <Upload className="h-4 w-4" />, badge: adminStats?.unmatchedBankTransactions },
        hasPermission('canViewReports') && { href: '/dashboard/admin/reports', label: t('reports.title'), icon: <BarChart3 className="h-4 w-4" /> },
        hasPermission('canManageSettings') && { href: '/dashboard/admin/settings', label: t('common.settings'), icon: <Settings className="h-4 w-4" /> },
        hasPermission('canManageSettings') && { href: '/dashboard/admin/settings/channels', label: t('admin.channels.title'), icon: <Layers className="h-4 w-4" /> },
        hasPermission('canManageSettings') && { href: '/dashboard/admin/billing', label: t('admin.billing.title'), icon: <CreditCard className="h-4 w-4" /> },
        hasPermission('canManageAdmins') && { href: '/dashboard/admin/team', label: t('admin.team.title'), icon: <UserCog className="h-4 w-4" /> },
        { href: '/dashboard/admin/changelog', label: t('changelog.title'), icon: <Megaphone className="h-4 w-4" /> },
      ].filter(Boolean) as NavItem[])
    : [];

  const systemNav: NavItem[] = isSystemAdmin
    ? [
        { href: '/dashboard/system', label: t('common.overview'), icon: <Shield className="h-4 w-4" /> },
        { href: '/dashboard/system/coops', label: t('system.coops.title'), icon: <Building2 className="h-4 w-4" /> },
        { href: '/dashboard/system/users', label: t('system.users.title'), icon: <Users className="h-4 w-4" /> },
        { href: '/dashboard/system/audit', label: t('system.nav.audit'), icon: <History className="h-4 w-4" /> },
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

  const handleResendVerification = async () => {
    setResendingVerification(true);
    setVerificationResent(false);
    try {
      await api('/auth/resend-verification', { method: 'POST' });
      setVerificationResent(true);
    } catch {
      // silently fail
    } finally {
      setResendingVerification(false);
    }
  };

  if (!user || emailVerified === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (emailVerified === false) {
    return (
      <div className="min-h-screen bg-muted/50 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-card rounded-xl border p-8 text-center shadow-sm">
          <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
            <MailIcon className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-semibold mb-2">{t('auth.verifyEmail')}</h2>
          <p className="text-sm text-muted-foreground mb-6">{t('auth.verifyEmailDescription')}</p>
          {verificationResent ? (
            <p className="text-sm text-green-600 font-medium mb-4">{t('auth.verifyEmailSent')}</p>
          ) : (
            <Button
              onClick={handleResendVerification}
              disabled={resendingVerification}
              variant="outline"
              className="w-full mb-4"
            >
              {resendingVerification && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('auth.resendVerification')}
            </Button>
          )}
          <Button variant="ghost" onClick={handleLogout} className="w-full">
            <LogOut className="w-4 h-4 mr-2" />
            {t('auth.logout')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/50">
      {/* Mobile menu button */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-card border-b px-4 py-3 flex items-center justify-between">
        {coopLogoUrl ? (
          <img src={coopLogoUrl} alt={coopName || ''} className="h-8 max-w-[140px] object-contain" />
        ) : (
          <span className="font-semibold text-lg">{coopName || 'OpenCoop'}</span>
        )}
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
            {coopLogoUrl ? (
              <img src={coopLogoUrl} alt={coopName || ''} className="h-8 max-w-[180px] object-contain" />
            ) : (
              <h1 className="text-xl font-bold text-primary">{coopName || 'OpenCoop'}</h1>
            )}
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
            {isAdmin && renderNavSection(t('common.myAccount'), [
              { href: '/dashboard/settings', label: t('common.settings'), icon: <Settings className="h-4 w-4" /> },
            ])}
            {isSystemAdmin && renderNavSection(t('system.title'), systemNav)}
          </div>

          {/* Docs link */}
          <div className="px-2 pb-2">
            <a
              href="https://docs.opencoop.be"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-3 py-2 text-sm rounded-md text-foreground/70 hover:bg-accent transition-colors"
            >
              <BookOpen className="h-4 w-4" />
              <span>{t('common.docs')}</span>
            </a>
          </div>

          {/* Language & theme controls */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-2 border-t">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>

          {/* User info + account switcher */}
          <div className="p-3 border-t">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center justify-between w-full text-left hover:bg-accent rounded-md px-1 py-1 transition-colors group">
                  <div className="text-sm truncate min-w-0">
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
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground ml-1 flex-shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {savedSessions.filter((s) => s.id !== activeSessionId).map((session) => (
                  <DropdownMenuItem
                    key={session.id}
                    onClick={() => handleSwitchSession(session.id)}
                    className="flex items-center gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      {session.name && <p className="text-sm font-medium truncate">{session.name}</p>}
                      <p className="text-xs text-muted-foreground truncate">{session.email}</p>
                    </div>
                  </DropdownMenuItem>
                ))}
                {savedSessions.filter((s) => s.id !== activeSessionId).length > 0 && (
                  <DropdownMenuSeparator />
                )}
                <DropdownMenuItem asChild>
                  <Link href="/login?addAccount=true" className="flex items-center gap-2">
                    <UserPlus className="h-4 w-4" />
                    {t('auth.addAccount')}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="flex items-center gap-2 text-destructive focus:text-destructive">
                  <LogOut className="h-4 w-4" />
                  {t('auth.logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
        {selectedCoop && selectedCoop.active !== false && selectedCoop.isReadOnly && (
          <div className="px-6 pt-6">
            <Alert className="border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
              <AlertDescription className="flex items-center justify-between">
                <span>{t('admin.billing.readOnlyBanner')}</span>
                <Link href="/dashboard/admin/billing">
                  <Button size="sm" variant="outline" className="ml-4 text-red-800 border-red-300 hover:bg-red-100 dark:text-red-200 dark:border-red-700">
                    {t('admin.billing.subscribe')}
                  </Button>
                </Link>
              </AlertDescription>
            </Alert>
          </div>
        )}
        {selectedCoop && selectedCoop.active !== false && !selectedCoop.isReadOnly && selectedCoop.plan !== 'FREE' && selectedCoop.trialEndsAt && (() => {
          const daysLeft = Math.ceil((new Date(selectedCoop.trialEndsAt!).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          return daysLeft > 0 && daysLeft <= 30;
        })() && (
          <div className="px-6 pt-6">
            <Alert className="border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-200">
              <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <AlertDescription className="flex items-center justify-between">
                <span>{t('admin.billing.trialBanner', { days: Math.ceil((new Date(selectedCoop.trialEndsAt!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) })}</span>
                <Link href="/dashboard/admin/billing">
                  <Button size="sm" variant="outline" className="ml-4 text-blue-800 border-blue-300 hover:bg-blue-100 dark:text-blue-200 dark:border-blue-700">
                    {t('admin.billing.subscribe')}
                  </Button>
                </Link>
              </AlertDescription>
            </Alert>
          </div>
        )}
        <div className="p-6">{children}</div>
      </main>

      {user && <FeedbackButton user={user} />}
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminProvider>
      <PermissionsProvider>
        <DashboardContent>{children}</DashboardContent>
      </PermissionsProvider>
    </AdminProvider>
  );
}
