'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ShoppingCart,
  ClipboardList,
  Package,
  Grid3X3,
  Users,
  UserCog,
  Settings,
  LogOut,
  ChefHat,
  UserCircle,
  MessageCircle,
  LifeBuoy,
  ChevronUp,
  Sun,
  Moon,
  Monitor,
  Boxes,
  Layers,
  DollarSign,
  ShieldCheck,
  UserCheck,
  Sparkles,
  Building2,
  Smartphone,
  QrCode,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations, type AppConfig } from 'use-intl';
import { useAuthStore } from '@/store/auth';
import { usePosSettingsStore } from '@/store/pos-settings';
import { getLandingPage } from '@/components/layout/AuthGuard';
import api from '@/lib/api';
import { useConfirm } from '@/hooks/use-confirm';
import { useThemeModeToggle } from '@/hooks/useThemeModeToggle';
import { useAppLanguage } from '@/lib/i18n/bilingual';
import type { PermissionId } from '@shared/permissions';
import { tenantCan } from '@/lib/permissions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';

// Leaf keys of the `nav` message namespace (use-intl resolves leaf keys
// within the namespace scope, so no dotted keys).
type NavKey = keyof AppConfig['Messages']['nav'];

interface NavItem {
  href: string;
  labelKey?: NavKey;
  label?: string;
  icon: LucideIcon;
  permission: PermissionId;
  businessTypes: string[] | null;
}

// null = show for all business types
const ALL_NAV_ITEMS: NavItem[] = [
  { href: '/pos', labelKey: 'pos', icon: ShoppingCart, permission: 'pos.use', businessTypes: null },
  { href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard, permission: 'dashboard.view', businessTypes: null },
  { href: '/orders', labelKey: 'orders', icon: ClipboardList, permission: 'orders.read', businessTypes: null },
  { href: '/whatsapp', labelKey: 'whatsapp', icon: MessageCircle, permission: 'whatsapp.use', businessTypes: null },
  { href: '/products', labelKey: 'products', icon: Package, permission: 'catalog.manage', businessTypes: null },
  { href: '/bom', label: 'BOM Costing', icon: Layers, permission: 'bom.costing.manage', businessTypes: null },
  { href: '/inventory', labelKey: 'inventory', icon: Boxes, permission: 'inventory.view', businessTypes: null },
  { href: '/finance', label: 'Finance & P&L', icon: DollarSign, permission: 'finance.expenses.view', businessTypes: null },
  { href: '/haccp', label: 'HACCP Safety', icon: ShieldCheck, permission: 'haccp.logs.view', businessTypes: null },
  { href: '/tables', labelKey: 'tables', icon: Grid3X3, permission: 'tables.manage', businessTypes: ['restaurant'] },
  { href: '/settings?tab=kds', labelKey: 'kds', icon: ChefHat, permission: 'kitchen.stations.manage', businessTypes: ['restaurant'] },
  { href: '/customers', labelKey: 'customers', icon: Users, permission: 'customers.view', businessTypes: null },
  { href: '/staff', labelKey: 'staff', icon: UserCog, permission: 'staff.view', businessTypes: null },
  { href: '/hrm', label: 'HRM & Payroll', icon: UserCheck, permission: 'hrm.payroll.view', businessTypes: null },
  { href: '/floadmin', label: 'FloAdmin', icon: Building2, permission: 'settings.manage', businessTypes: null },
  { href: '/florev', label: 'FloRev Live', icon: Smartphone, permission: 'dashboard.view', businessTypes: null },
  { href: '/orderflo', label: 'OrderFlo Hub', icon: QrCode, permission: 'orders.create', businessTypes: null },
  { href: '/owner-assist', label: 'Owner Assist', icon: Sparkles, permission: 'owner.assist.view', businessTypes: null },
  { href: '/settings', labelKey: 'settings', icon: Settings, permission: 'settings.view', businessTypes: null },
];

export default function AppSidebar() {
  const pathname = usePathname();
  const { tr, isAr } = useAppLanguage();
  const { user, currentTenant, logout } = useAuthStore();
  const { tablesRequired, kdsEnabled, whatsappEnabled, setTablesRequired, setKdsEnabled, setWhatsappEnabled } = usePosSettingsStore();
  const { isMobile, setOpenMobile } = useSidebar();
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');
  const { confirm, ConfirmDialog } = useConfirm();
  const [emailNeedsAttention, setEmailNeedsAttention] = useState(false);
  const closeMobile = () => { if (isMobile) setOpenMobile(false); };
  const tSettings = useTranslations('settings');
  const { mode: themeMode, cycle: cycleThemeMode } = useThemeModeToggle();
  const themeModeIcon = themeMode === 'light' ? Sun : themeMode === 'dark' ? Moon : Monitor;
  const themeModeLabel = themeMode === 'light'
    ? tSettings('themeLight')
    : themeMode === 'dark'
      ? tSettings('themeDark')
      : tSettings('themeSystem');
  const ThemeModeIcon = themeModeIcon;

  const getLocalizedNavLabel = (item: NavItem): string => {
    switch (item.href) {
      case '/pos':
        return tr('Point of Sale', 'نقطة البيع الكاشير');
      case '/dashboard':
        return tr('Dashboard & Analytics', 'لوحة التحكم والتحليلات');
      case '/orders':
        return tr('Orders & Receipts', 'الطلبات والفواتير');
      case '/whatsapp':
        return tr('WhatsApp Marketing', 'واتساب واستعادة العملاء');
      case '/products':
        return tr('Product Catalog', 'قائمة المنتجات والأصناف');
      case '/bom':
        return tr('BOM Costing & Yield', 'تكلفة الوصفات والإنتاج BOM');
      case '/inventory':
        return tr('Inventory & Purchasing', 'المخزون والمستودع والمشتريات');
      case '/finance':
        return tr('Finance & P&L', 'المالية والأرباح والمصروفات');
      case '/haccp':
        return tr('HACCP Safety & Hygiene', 'سلامة الغذاء والنظافة HACCP');
      case '/tables':
        return tr('Tables & Dine-In', 'إدارة الطاولات والصالة');
      case '/settings?tab=kds':
        return tr('Kitchen Display KDS', 'شاشة المطبخ KDS');
      case '/customers':
        return tr('Customers & Loyalty', 'العملاء وبرنامج الولاء');
      case '/staff':
        return tr('Staff & Permissions', 'الموظفون والصلاحيات');
      case '/hrm':
        return tr('HRM & Payroll Ledger', 'شؤون الموظفين والرواتب');
      case '/floadmin':
        return tr('FloAdmin HQ Fleet', 'إدارة الفروع المركزية FloAdmin');
      case '/florev':
        return tr('FloRev Live Sales', 'فلو ريف المبيعات المباشرة');
      case '/orderflo':
        return tr('OrderFlo QR Ordering', 'أوردر فلو للطلب الذاتي QR');
      case '/owner-assist':
        return tr('Owner Copilot Assist', 'مساعد المالك الذكي AI');
      case '/settings':
        return tr('System Settings', 'إعدادات النظام');
      default:
        return item.label || (item.labelKey ? t(item.labelKey) : '');
    }
  };

  const businessType = currentTenant?.business_type || 'restaurant';
  const navItems = ALL_NAV_ITEMS.filter((item) => {
    if (item.href === '/tables' && !tablesRequired) return false;
    // Hide KDS settings navigation when KDS is disabled.
    if (item.href === '/settings?tab=kds' && !kdsEnabled) return false;
    // WhatsApp integration not enabled on this tenant → hide the nav entry.
    if (item.href === '/whatsapp' && !whatsappEnabled) return false;
    const permitted = item.href === '/staff'
      ? tenantCan(currentTenant, 'staff.view') || tenantCan(currentTenant, 'authorization.manage')
      : item.href === '/settings'
        ? [
            'settings.view', 'settings.manage', 'tax-packs.view-test', 'tax-configuration.manage',
            'tax-packs.manage', 'printers.manage', 'print-templates.view', 'print-templates.manage',
            'payment-methods.manage', 'cloud.manage', 'cloud.account.manage', 'google-drive.manage',
            'database.manage', 'mobile-access.manage', 'kitchen.stations.manage', 'whatsapp.manage',
          ].some((permission) => tenantCan(currentTenant, permission as PermissionId))
        : tenantCan(currentTenant, item.permission);
    return permitted
      && (item.businessTypes === null || item.businessTypes.includes(businessType));
  });
  const homeHref = getLandingPage(currentTenant);

  useEffect(() => {
    if (!currentTenant) return;
    api.get('/settings/business')
      .then((res) => {
        setTablesRequired(typeof res.data.tables_required === 'boolean' ? res.data.tables_required : true);
      })
      .catch(() => { });
    api.get('/settings/kds_enabled')
      .then((res) => setKdsEnabled(res.data.setting?.value !== 'false'))
      .catch(() => { });
    // Sync WhatsApp status from backend so sidebar only shows the entry
    // when integration is enabled on this tenant.
    api.get('/whatsapp/status')
      .then((res) => setWhatsappEnabled(!!res.data?.enabled))
      .catch(() => { });
  }, [currentTenant, setTablesRequired, setKdsEnabled, setWhatsappEnabled]);

  useEffect(() => {
    if (!tenantCan(currentTenant, 'cloud.account.manage')) return;
    let active = true;
    const refreshCloudAttention = async () => {
      try {
        const [accountResponse, cloudResponse] = await Promise.all([
          api.get('/settings/cloud/account'),
          api.get('/settings/cloud'),
        ]);
        if (!active) return;
        const deletionStatus = accountResponse.data?.deletion_request?.status || cloudResponse.data?.cloud_deletion_status;
        setEmailNeedsAttention(
          (accountResponse.data?.cloud_account_available !== false && Boolean(accountResponse.data?.email) && !accountResponse.data?.verified)
          || ['pending', 'processing', 'failed'].includes(deletionStatus)
        );
      } catch {
        if (active) setEmailNeedsAttention(false);
      }
    };
    void refreshCloudAttention();
    window.addEventListener('flo:cloud-account-status-changed', refreshCloudAttention);
    return () => {
      active = false;
      window.removeEventListener('flo:cloud-account-status-changed', refreshCloudAttention);
    };
  }, [currentTenant]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={homeHref}>
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground font-semibold">
                  {(currentTenant?.business_name || tCommon('brandName')).charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col gap-0.5 min-w-0 leading-none">
                  <span className="font-semibold truncate">{currentTenant?.business_name || tCommon('brandName')}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const [hrefPath, hrefQuery] = item.href.split('?');
                const isActive = !hrefQuery && (pathname === hrefPath || pathname?.startsWith(hrefPath + '/'));
                const itemLabel = getLocalizedNavLabel(item);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={itemLabel}>
                      <Link href={item.href} onClick={closeMobile}>
                        <span className="relative flex size-4 shrink-0 items-center justify-center">
                          <item.icon className="size-4 shrink-0" />
                          {item.href === '/settings' && emailNeedsAttention && (
                            <span aria-label="Email verification required" className="absolute -end-1 -top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-sidebar" />
                          )}
                        </span>
                        <span>{itemLabel}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={cycleThemeMode}
              tooltip={`${tSettings('themeTitle')}: ${themeModeLabel}`}
            >
              <ThemeModeIcon className="size-4 shrink-0" />
              <span>{tSettings('themeTitle')}</span>
              <span className="ms-auto text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                {themeModeLabel}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  className="rounded-xl border-0 bg-sidebar-accent/60 hover:bg-sidebar-accent hover:shadow-xs data-[state=open]:bg-sidebar-accent/90 transition-all h-9 px-3 font-normal group-data-[collapsible=icon]:h-8! group-data-[collapsible=icon]:p-2! group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:rounded-lg"
                  tooltip={user?.name || user?.email || tr('User Account', 'حساب المستخدم')}
                >
                  <UserCircle className="size-4 shrink-0 text-sidebar-primary" />
                  <span className="font-medium text-sm truncate group-data-[collapsible=icon]:hidden text-sidebar-foreground">
                    {user?.name || user?.email || tr('User Account', 'حساب المستخدم')}
                  </span>
                  <ChevronUp className="ms-auto size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side={isMobile ? "bottom" : "top"}
                align={isMobile ? "end" : "start"}
                className="w-56 rounded-lg"
              >
                <DropdownMenuItem asChild className="cursor-pointer">
                  <Link href="/support" onClick={closeMobile} className="flex items-center gap-2">
                    <LifeBuoy className="size-4 shrink-0" />
                    <span>{tr('Support & Helpdesk', 'الدعم الفني والمساعدة')}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    if (await confirm(tr('Are you sure you want to log out?', 'هل أنت متأكد من تسجيل الخروج؟'))) logout();
                  }}
                  className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/50 flex items-center gap-2"
                >
                  <LogOut className="size-4 shrink-0" />
                  <span>{tr('Log Out', 'تسجيل الخروج')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
      {ConfirmDialog}
    </Sidebar>
  );
}
