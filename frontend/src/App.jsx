import React from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  Pill,
  GitFork,
  FlaskConical,
  FileCheck,
  Building2,
  Activity,
  ShieldAlert,
  FileText,
  QrCode,
  Building,
  Scale,
  LogOut,
  Microscope,
  CloudDownload,
  FileText as FileTextIcon,
  Users,
} from 'lucide-react';

import Dashboard from './pages/Dashboard';
import InventoryManager from './pages/InventoryManager';
import AntibioticCatalog from './pages/AntibioticCatalog';
import SupplierGraph from './pages/SupplierGraph';
import BarcodeScanner from './pages/BarcodeScanner';
import DepartmentAllocation from './pages/DepartmentAllocation';
import GovernancePanel from './pages/GovernancePanel';
import Recommendations from './pages/Recommendations';
import ScenariosLab from './pages/ScenariosLab';
import AuditHistory from './pages/AuditHistory';
import AmrExplorer from './pages/AmrExplorer';
import AdminIngestion from './pages/AdminIngestion';
import VendorDocuments from './pages/VendorDocuments';
import UserManagement from './pages/UserManagement';
import MyAccount from './pages/MyAccount';
import Login from './pages/Login';

import { isAuthenticated, getUser, clearSession } from './api/auth';

const ADMIN_ROLES = ['admin', 'chief_pharmacist'];

const navLinkClass = ({ isActive }) =>
  `flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors ${
    isActive
      ? 'bg-sky-50 text-sky-800 font-semibold'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`;

function initials(name) {
  return (name || 'User')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function Shell() {
  const user = getUser();
  const location = useLocation();
  const isAdmin = ADMIN_ROLES.includes(user?.role);

  const logout = () => {
    clearSession();
    window.location.assign('/login');
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans antialiased overflow-hidden">
      <aside className="w-64 border-r border-slate-200 bg-white flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-100 flex items-center gap-3">
          <div className="p-2 bg-sky-50 text-sky-700 rounded-md border border-sky-200">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900 leading-tight">Apollo Health</h1>
            <p className="text-xs text-slate-500 font-medium">AMR Resilience Engine</p>
          </div>
        </div>

        <nav className="p-3 space-y-1 text-sm font-medium flex-1 overflow-y-auto">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Operations</div>
          <NavLink to="/" end className={navLinkClass}><LayoutDashboard className="w-4 h-4" />Overview</NavLink>
          <NavLink to="/amr" className={navLinkClass}><Activity className="w-4 h-4" />AMR Trends</NavLink>
          <NavLink to="/inventory" className={navLinkClass}><Package className="w-4 h-4" />Inventory</NavLink>
          <NavLink to="/barcode" className={navLinkClass}><QrCode className="w-4 h-4" />Barcode Scanner</NavLink>
          <NavLink to="/departments" className={navLinkClass}><Building className="w-4 h-4" />Department Allocation</NavLink>
          <NavLink to="/catalog" className={navLinkClass}><Pill className="w-4 h-4" />Formulary Catalog</NavLink>
          <NavLink to="/amr-explorer" className={navLinkClass}><Microscope className="w-4 h-4" />AMR Explorer</NavLink>

          <div className="pt-4 px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Resilience Tools</div>
          <NavLink to="/suppliers" className={navLinkClass}><GitFork className="w-4 h-4" />Supply Chain</NavLink>
          <NavLink to="/recommendations" className={navLinkClass}><FileText className="w-4 h-4" />Risk & Recommendations</NavLink>
          <NavLink to="/governance" className={navLinkClass}><Scale className="w-4 h-4" />Governance Panel</NavLink>
          <NavLink to="/scenarios" className={navLinkClass}><FlaskConical className="w-4 h-4" />Scenarios Lab</NavLink>
          <NavLink to="/audit" className={navLinkClass}><FileCheck className="w-4 h-4" />Operational History</NavLink>

          {isAdmin && (
            <>
              <div className="pt-4 px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Administration</div>
              <NavLink to="/admin/users" className={navLinkClass}><Users className="w-4 h-4" />Staff Accounts</NavLink>
              <NavLink to="/admin/ingestion" className={navLinkClass}><CloudDownload className="w-4 h-4" />Data Ingestion</NavLink>
              <NavLink to="/admin/vendor-docs" className={navLinkClass}><FileTextIcon className="w-4 h-4" />Vendor Documents</NavLink>
            </>
          )}
        </nav>

        <div className="p-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-500">
          <NavLink to="/account" className="flex items-center gap-2.5 mb-2 rounded-md p-1 -m-1 hover:bg-slate-100" title="My account">
            <div className="w-7 h-7 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 border border-sky-200 font-semibold text-[10px]">
              {initials(user?.name)}
            </div>
            <div className="overflow-hidden flex-1">
              <p className="font-medium text-slate-800 truncate text-xs">{user?.name || 'Signed in'}</p>
              <p className="text-[10px] text-slate-500 truncate">
                {user?.roleLabel || user?.role} · {user?.departmentCode}
              </p>
            </div>
          </NavLink>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-medium text-[11px]"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold px-2 py-1 bg-slate-100 text-slate-700 rounded border border-slate-200">
              {user?.hospitalId || 'H001'} · {user?.departmentCode || '—'}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium text-slate-600">
            <NavLink to="/recommendations" className="flex items-center gap-1.5 text-amber-700 bg-amber-50 px-2.5 py-1 rounded border border-amber-200 hover:bg-amber-100">
              <ShieldAlert className="w-3.5 h-3.5" />
              View active risks
            </NavLink>
            <div className="h-4 w-px bg-slate-200" />
            <span>{user?.roleLabel || user?.role}</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 bg-slate-50">
          <Routes>
            <Route path="/" element={<Dashboard initialTab="overview" />} />
            <Route path="/amr" element={<Dashboard initialTab="amr" />} />
            <Route path="/inventory" element={<InventoryManager />} />
            <Route path="/barcode" element={<BarcodeScanner />} />
            <Route path="/departments" element={<DepartmentAllocation />} />
            <Route path="/governance" element={<GovernancePanel />} />
            <Route path="/catalog" element={<AntibioticCatalog />} />
            <Route path="/suppliers" element={<SupplierGraph />} />
            <Route path="/supplychain" element={<SupplierGraph />} />
            <Route path="/recommendations" element={<Recommendations />} />
            <Route path="/risk" element={<Recommendations />} />
            <Route path="/scenarios" element={<ScenariosLab />} />
            <Route path="/audit" element={<AuditHistory />} />
            <Route path="/history" element={<AuditHistory />} />
            <Route path="/amr-explorer" element={<AmrExplorer />} />
            <Route path="/account" element={<MyAccount />} />
            <Route path="/admin/users" element={isAdmin ? <UserManagement /> : <Navigate to="/" replace />} />
            <Route path="/admin/ingestion" element={isAdmin ? <AdminIngestion /> : <Navigate to="/" replace />} />
            <Route path="/admin/vendor-docs" element={isAdmin ? <VendorDocuments /> : <Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={isAuthenticated() ? <Navigate to="/" replace /> : <Login />}
        />
        <Route
          path="/*"
          element={isAuthenticated() ? <Shell /> : <Navigate to="/login" replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}
