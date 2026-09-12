import { BrowserRouter, Route, Routes } from 'react-router'

import { AppShell } from '@/components/layout/AppShell'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { LandingRedirect } from '@/features/auth/LandingRedirect'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { RequireRole } from '@/features/auth/RequireRole'
import { ThemeProvider } from '@/features/theme/ThemeProvider'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { CategoriesPage } from '@/features/menu/CategoriesPage'
import { MenuItemFormPage } from '@/features/menu/MenuItemFormPage'
import { MenuListPage } from '@/features/menu/MenuListPage'
import { ReportsPage } from '@/features/reports/ReportsPage'
import { StaffListPage } from '@/features/staff/StaffListPage'
import { StaffSessionProvider } from '@/features/staff/StaffSessionProvider'
import { OrderDetailPage } from '@/features/pos/OrderDetailPage'
import { OrdersListPage } from '@/features/pos/OrdersListPage'
import { QueuePage } from '@/features/pos/QueuePage'
import { TerminalPage } from '@/features/pos/TerminalPage'
import { AdminPage } from '@/pages/AdminPage'
import { ForbiddenPage } from '@/pages/ForbiddenPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

export function App() {
  return (
    /* Outermost, so the palette is settled before the first screen paints — including the
       login page, which renders outside every other provider. */
    <ThemeProvider>
      <AuthProvider>
        {/* Inside AuthProvider: the roster subscription requires an authenticated active
          user, so it must not mount before auth has resolved. */}
        <StaffSessionProvider>
          <BrowserRouter>
            <Routes>
              {/* There is no /signup route anywhere, by design. */}
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route element={<AppShell />}>
                  {/* Role decides where a session starts — staff at New Order, admin at
                    the Dashboard. See landingPathFor in nav-items.ts. */}
                  <Route index element={<LandingRedirect />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  {/* The catalog is readable by both roles — staff serve from it. */}
                  <Route path="/menu" element={<MenuListPage />} />
                  {/* The till and the sales record: both roles, since staff work them. */}
                  <Route path="/pos" element={<TerminalPage />} />
                  <Route path="/orders" element={<OrdersListPage />} />
                  {/* The kitchen board. Both roles: whoever is making the food moves it. */}
                  <Route path="/queue" element={<QueuePage />} />
                  <Route path="/orders/:orderId" element={<OrderDetailPage />} />
                  {/* Admin-only group. Later admin routes nest here rather than
                  repeating the guard. */}
                  <Route element={<RequireRole allow={['admin']} />}>
                    <Route path="/admin" element={<AdminPage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/staff" element={<StaffListPage />} />
                    <Route path="/menu/categories" element={<CategoriesPage />} />
                    <Route path="/menu/new" element={<MenuItemFormPage />} />
                    <Route path="/menu/:itemId/edit" element={<MenuItemFormPage />} />
                  </Route>
                  <Route path="/403" element={<ForbiddenPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </StaffSessionProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
