/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './components/LandingPage';
import ReservationPage from './components/ReservationPage';
import GymMembershipPage from './components/GymMembershipPage';
import CouponsPage from './components/CouponsPage';
import CashbackPage from './components/CashbackPage';
import PhysioPage from './components/PhysioPage';
import MembersPage from './components/MembersPage';
import { POSPage } from './components/POSPage';
import LoginPage from './components/LoginPage';
import StaffManagementPage from './components/StaffManagementPage';
import AnalyticsPage from './components/AnalyticsPage';
import GlobalSettingsPage from './components/GlobalSettingsPage';
import MemberProfilePage from './components/MemberProfilePage';
import MasterCalendarPage from './components/MasterCalendarPage';
import PatientSelfIntakePage from './components/physio/PatientSelfIntakePage';
import { AccountingApp } from './components/AccountingApp';
import { AdvancedAccountingApp } from './components/AdvancedAccountingApp';
import { CommandPalette } from './components/CommandPalette';
import { DevDiagnosticsPill } from './components/DevDiagnosticsPill';

const AccountingRouter = () => {
  const { accountingMode, userProfile } = useFirebase();
  const isAdmin = userProfile?.role === 'admin';
  const subAccess = isAdmin ? 'both' : (userProfile?.permissions?.accountingAccess || 'real_time');
  const [localMode, setLocalMode] = React.useState<'real_time' | 'batch_manual' | null>(null);

  if (subAccess === 'real_time') {
    return <AccountingApp canSwitchMode={false} />;
  }
  if (subAccess === 'posting') {
    return <AdvancedAccountingApp canSwitchMode={false} />;
  }

  const effectiveMode = localMode || accountingMode;
  return effectiveMode === 'batch_manual'
    ? <AdvancedAccountingApp canSwitchMode={true} onSwitchMode={() => setLocalMode('real_time')} />
    : <AccountingApp canSwitchMode={true} onSwitchMode={() => setLocalMode('batch_manual')} />;
};
import { HRManagementApp } from './components/HRManagementApp';
import { FirebaseProvider, useFirebase } from './contexts/FirebaseContext';
import { Toaster } from 'sonner';

const ProtectedRoute = ({ children, requiredPermission }: { children: React.ReactNode, requiredPermission?: keyof import('./contexts/FirebaseContext').UserPermissions }) => {
  const { user, userProfile, isAuthReady } = useFirebase();

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-zinc-950 transition-colors">
        <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-500/20 mb-8 animate-pulse">
          <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-500 animate-pulse">Initializing Interface</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requiredPermission && userProfile && userProfile.role !== 'admin' && !userProfile.permissions[requiredPermission]) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const AppContent = () => {
  const { user, isAuthReady } = useFirebase();

  return (
    <BrowserRouter>
      {user && <CommandPalette />}
      <Routes>
        {/* Public Short Links for Patient Self-Intake (No Login Required) */}
        <Route path="/p/:token" element={<PatientSelfIntakePage />} />
        <Route path="/intake" element={<PatientSelfIntakePage />} />

        <Route path="/login" element={!isAuthReady ? <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-zinc-950">Loading...</div> : (!user ? <LoginPage /> : <Navigate to="/" replace />)} />
        
        <Route path="/" element={<ProtectedRoute><LandingPage /></ProtectedRoute>} />
        <Route path="/master-calendar" element={<ProtectedRoute><MasterCalendarPage /></ProtectedRoute>} />
        <Route path="/reservations" element={<ProtectedRoute requiredPermission="reservations"><ReservationPage /></ProtectedRoute>} />
        <Route path="/gym" element={<ProtectedRoute requiredPermission="gym"><GymMembershipPage /></ProtectedRoute>} />
        <Route path="/coupons" element={<ProtectedRoute requiredPermission="coupons"><CouponsPage /></ProtectedRoute>} />
        <Route path="/cashback" element={<ProtectedRoute requiredPermission="cashback"><CashbackPage /></ProtectedRoute>} />
        <Route path="/physio" element={<ProtectedRoute requiredPermission="physio"><PhysioPage /></ProtectedRoute>} />
        <Route path="/members" element={<ProtectedRoute requiredPermission="members"><MembersPage /></ProtectedRoute>} />
        <Route path="/pos/cafeteria" element={<ProtectedRoute requiredPermission="pos"><POSPage type="cafeteria" /></ProtectedRoute>} />
        <Route path="/pos/retail" element={<ProtectedRoute requiredPermission="pos"><POSPage type="retail" /></ProtectedRoute>} />
        <Route path="/staff" element={<ProtectedRoute requiredPermission="staff"><StaffManagementPage /></ProtectedRoute>} />
        <Route path="/hr" element={<ProtectedRoute requiredPermission="hr"><HRManagementApp /></ProtectedRoute>} />
        <Route path="/analytics" element={<ProtectedRoute requiredPermission="analytics"><AnalyticsPage /></ProtectedRoute>} />
        <Route path="/accounting" element={<ProtectedRoute requiredPermission="accounting"><AccountingRouter /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute requiredPermission="settings"><GlobalSettingsPage /></ProtectedRoute>} />
        <Route path="/members/:id" element={<ProtectedRoute requiredPermission="members"><MemberProfilePage /></ProtectedRoute>} />
      </Routes>
      <DevDiagnosticsPill />
      <Toaster position="top-right" richColors />
    </BrowserRouter>
  );
};

import { ThemeProvider } from './contexts/ThemeContext';

export default function App() {
  return (
    <FirebaseProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </FirebaseProvider>
  );
}
