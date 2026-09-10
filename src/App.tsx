import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { AppShell } from '@/components/layout/AppShell'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { RequireRole } from '@/features/auth/RequireRole'
import { CategoriesPage } from '@/features/menu/CategoriesPage'
import { MenuItemFormPage } from '@/features/menu/MenuItemFormPage'
import { MenuListPage } from '@/features/menu/MenuListPage'
import { AdminPage } from '@/pages/AdminPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { ForbiddenPage } from '@/pages/ForbiddenPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* There is no /signup route anywhere, by design. */}
          <Route path="/login" element={<LoginPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />

              {/* The catalog is readable by both roles — staff serve from it. */}
              <Route path="/menu" element={<MenuListPage />} />

              {/* Admin-only group. Later admin routes nest here rather than
                  repeating the guard. */}
              <Route element={<RequireRole allow={['admin']} />}>
                <Route path="/admin" element={<AdminPage />} />
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
    </AuthProvider>
  )
}
