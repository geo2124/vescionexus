import React, { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeToggle } from './ThemeToggle';
import { useFirebase } from '../contexts/FirebaseContext';
import { ShieldCheck, Lock, User, Loader2, Activity, Calendar, Dumbbell } from 'lucide-react';
import { toast } from 'sonner';
import { VescioNexusLogo } from './VescioNexusLogo';

export default function LoginPage() {
  const { loginWithCredentials, login } = useFirebase();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { isDarkMode, toggleDarkMode } = useTheme();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error('Please enter both username and password');
      return;
    }

    setLoading(true);
    try {
      await loginWithCredentials(username, password);
      toast.success('Login successful');
    } catch (error: any) {
      console.error('Login error:', error);
      toast.error(error.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex ${isDarkMode ? 'bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'} font-sans relative overflow-hidden`}>
      {/* Ambient Radial Cyan Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,184,200,0.12),transparent_60%)] pointer-events-none" />

      {/* Top-right Theme Toggle */}
      <div className="absolute top-6 right-6 z-30">
        <ThemeToggle isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
      </div>

      {/* Left Panel - Vescio Nexus Brand Architecture & Hero */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#05070A] border-r border-zinc-800/80 p-12 flex-col justify-between relative overflow-hidden">
        {/* Radial Cyan Glow & Subtle Grid */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,184,200,0.16),transparent_60%)] pointer-events-none" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-[#00B8C8]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-16">
            <div className="dark">
              <VescioNexusLogo variant="horizontal" size="lg" showVescioPrefix={true} />
            </div>
            <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-cyan-500/10 text-[#00B8C8] border border-cyan-500/30">
              Enterprise Edition
            </span>
          </div>

          <div className="max-w-xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#00B8C8] mb-3">
              Enterprise Resource Planning & Facility Operating System
            </p>
            <h2 className="text-5xl font-extrabold text-zinc-100 tracking-tight leading-[1.1] mb-6">
              Unified precision across every facility touchpoint.
            </h2>
            <p className="text-zinc-400 text-base font-medium leading-relaxed mb-12">
              Orchestrate memberships, multi-court bookings, clinical physiotherapy, POS inventory, and Lebanese dual-mode general ledger accounting in real time.
            </p>

            <div className="grid grid-cols-2 gap-5">
              {[
                { icon: Dumbbell, title: 'Gym & Biometrics', text: 'Track active subscriptions, trainer quotas & QR check-ins.' },
                { icon: Calendar, title: 'Court Reservations', text: 'Basketball, Padel & Tennis scheduling with instant billing.' },
                { icon: Activity, title: 'Physiotherapy', text: 'Clinical recovery packages, SOAP notes & practitioner splits.' },
                { icon: ShieldCheck, title: 'Dual-Mode LCOA GL', text: 'Real-time & batch accounting with MOF sequential invoicing.' }
              ].map((feature, i) => (
                <div key={i} className="bg-[#0B0F17]/90 backdrop-blur-sm border border-zinc-800/80 hover:border-cyan-500/40 transition-colors p-5 rounded-2xl">
                  <feature.icon size={22} className="text-[#00B8C8] mb-3" />
                  <h3 className="text-zinc-100 font-bold text-sm mb-1">{feature.title}</h3>
                  <p className="text-zinc-400 text-xs leading-relaxed">{feature.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between text-zinc-500 text-xs font-medium pt-6 border-t border-zinc-900">
          <p>© 2026 Vescio Nexus ERP • Multi-Tenant Architecture</p>
          <div className="flex gap-6">
            <span className="text-[#00B8C8] font-mono">AES-256 RBAC</span>
          </div>
        </div>
      </div>

      {/* Right Panel - Authentication Card */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-8 relative z-10">
        <div className="max-w-md w-full">
          <div className={`p-8 sm:p-10 rounded-3xl border transition-all relative overflow-hidden ${
            isDarkMode
              ? 'bg-[#0B0F17]/95 border-zinc-800/80 shadow-[0_0_50px_-15px_rgba(0,184,200,0.18)]'
              : 'bg-white border-slate-200/80 shadow-xl shadow-slate-200/60'
          }`}>
            {/* Subtle top radial cyan highlight inside card */}
            <div className="absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_top,rgba(0,184,200,0.14),transparent_70%)] pointer-events-none" />

            {/* Centered Stacked XL Vescio Nexus Logo */}
            <div className="relative z-10 flex flex-col items-center text-center mb-8">
              <VescioNexusLogo variant="stacked" size="xl" showVescioPrefix={true} className="mb-3" />
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#00B8C8] mt-1">
                Enterprise Resource Planning & Facility Operating System
              </p>
              <p className={`text-xs mt-2 font-medium ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                Sign in with your operator credentials to access the workspace
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
              <div>
                <label className={`block text-xs font-bold uppercase tracking-widest mb-2 ${isDarkMode ? 'text-zinc-400' : 'text-slate-600'}`}>Username</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <User size={18} className={isDarkMode ? 'text-zinc-500' : 'text-slate-400'} />
                  </div>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="el-input !pl-11 !py-3.5"
                    placeholder="Enter your username"
                  />
                </div>
              </div>

              <div>
                <label className={`block text-xs font-bold uppercase tracking-widest mb-2 ${isDarkMode ? 'text-zinc-400' : 'text-slate-600'}`}>Password</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock size={18} className={isDarkMode ? 'text-zinc-500' : 'text-slate-400'} />
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="el-input !pl-11 !py-3.5"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 font-bold py-3.5 px-4 rounded-xl transition-all disabled:opacity-70 flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20"
              >
                {loading ? <Loader2 size={20} className="animate-spin" /> : 'Sign In to Vescio Nexus'}
              </button>
            </form>

            <div className="mt-8 pt-6 border-t border-slate-200 dark:border-zinc-800/80 relative z-10">
              <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-4 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'bg-[#0B0F17] text-zinc-500' : 'bg-white text-slate-400'}`}>
                Or continue with
              </div>
              
              <button
                onClick={() => login()}
                className={`w-full font-bold py-3.5 px-4 rounded-xl transition-all flex items-center justify-center gap-3 border ${
                  isDarkMode 
                    ? 'bg-[#101622] text-zinc-200 border-zinc-800 hover:border-cyan-500/40 hover:text-white' 
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-cyan-500/40 hover:text-slate-900 shadow-sm'
                }`}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Google Account
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

