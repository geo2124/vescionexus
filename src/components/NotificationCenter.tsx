import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Bell, AlertTriangle, AlertCircle, Info, CheckCheck, ExternalLink, Package, Dumbbell, Calendar, BarChart3, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { format, differenceInDays } from 'date-fns';

export interface NotificationAlert {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  module: 'pos' | 'gym' | 'reservations' | 'accounting';
  targetPath: string;
  timestamp: string;
  isUnsolvedOperational?: boolean;
}

interface NotificationStateTracker {
  seenIds: string[];
  clickedIds: string[];
  dismissedIds: string[];
}

interface NotificationCenterProps {
  isDarkMode: boolean;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ isDarkMode }) => {
  const navigate = useNavigate();
  const { user, userProfile, formatCurrency } = useFirebase();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [inventory, setInventory] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [advTxns, setAdvTxns] = useState<any[]>([]);

  const storageKey = `vescio_notifications_state_${user?.uid || 'guest'}`;
  const [notifState, setNotifState] = useState<NotificationStateTracker>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          seenIds: Array.isArray(parsed.seenIds) ? parsed.seenIds : [],
          clickedIds: Array.isArray(parsed.clickedIds) ? parsed.clickedIds : [],
          dismissedIds: Array.isArray(parsed.dismissedIds) ? parsed.dismissedIds : []
        };
      }
    } catch {
      // ignore
    }
    return { seenIds: [], clickedIds: [], dismissedIds: [] };
  });

  const persistNotifState = (next: NotificationStateTracker) => {
    setNotifState(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        setNotifState({
          seenIds: Array.isArray(parsed.seenIds) ? parsed.seenIds : [],
          clickedIds: Array.isArray(parsed.clickedIds) ? parsed.clickedIds : [],
          dismissedIds: Array.isArray(parsed.dismissedIds) ? parsed.dismissedIds : []
        });
      }
    } catch {
      // ignore
    }
  }, [storageKey]);

  const isAdmin = !userProfile || userProfile.role === 'admin';
  const canPos = isAdmin || !!userProfile?.permissions?.pos;
  const canGym = isAdmin || !!userProfile?.permissions?.gym;
  const canReservations = isAdmin || !!userProfile?.permissions?.reservations;
  const canAccounting = isAdmin || !!userProfile?.permissions?.accounting;

  useEffect(() => {
    if (!user) return;
    const unsubs: (() => void)[] = [];

    if (canPos) {
      unsubs.push(
        onSnapshot(collection(db, 'inventory'), (snap) => {
          setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, () => {})
      );
    }

    if (canGym) {
      unsubs.push(
        onSnapshot(collection(db, 'members'), (snap) => {
          setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, () => {})
      );
    }

    if (canReservations) {
      unsubs.push(
        onSnapshot(collection(db, 'bookings'), (snap) => {
          setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, () => {})
      );
    }

    if (canAccounting) {
      unsubs.push(
        onSnapshot(collection(db, 'expenses'), (snap) => {
          setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, () => {})
      );
      unsubs.push(
        onSnapshot(collection(db, 'advanced_transactions'), (snap) => {
          setAdvTxns(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, () => {})
      );
    }

    return () => unsubs.forEach(u => u());
  }, [user, canPos, canGym, canReservations, canAccounting]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const rawAlerts = useMemo<NotificationAlert[]>(() => {
    const list: NotificationAlert[] = [];
    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');

    // 1. POS Alerts (Low Stock & Expiring Items)
    if (canPos) {
      inventory.forEach(item => {
        const stock = Number(item.stock || 0);
        const threshold = Number(item.lowStockThreshold ?? 10);
        const targetPosPath = item.posType === 'retail' ? '/pos/retail' : '/pos/cafeteria';
        const posLabel = item.posType === 'retail' ? 'Retail POS' : 'Kiosk POS';

        if (stock <= 0) {
          list.push({
            id: `low-stock-out-${item.id}`,
            title: `Out of Stock: ${item.name}`,
            description: `${posLabel} item "${item.name}" has 0 units remaining.`,
            severity: 'critical',
            module: 'pos',
            targetPath: targetPosPath,
            timestamp: todayStr,
            isUnsolvedOperational: true
          });
        } else if (stock <= threshold) {
          list.push({
            id: `low-stock-${item.id}`,
            title: `Low Stock: ${item.name}`,
            description: `${posLabel} item "${item.name}" is at ${stock} units (threshold: ${threshold}).`,
            severity: 'warning',
            module: 'pos',
            targetPath: targetPosPath,
            timestamp: todayStr,
            isUnsolvedOperational: true
          });
        }

        if (item.expiryDate) {
          const daysToExpiry = differenceInDays(new Date(item.expiryDate), now);
          if (daysToExpiry < 0) {
            list.push({
              id: `pos-exp-${item.id}`,
              title: `Expired Batch: ${item.name}`,
              description: `${posLabel} item expired on ${item.expiryDate}. Write off immediately.`,
              severity: 'critical',
              module: 'pos',
              targetPath: targetPosPath,
              timestamp: item.expiryDate,
              isUnsolvedOperational: true
            });
          } else if (daysToExpiry <= 7) {
            list.push({
              id: `pos-expsoon-${item.id}`,
              title: `Expiring Soon: ${item.name}`,
              description: `${posLabel} item expires in ${daysToExpiry} day(s) (${item.expiryDate}).`,
              severity: 'warning',
              module: 'pos',
              targetPath: targetPosPath,
              timestamp: item.expiryDate,
              isUnsolvedOperational: true
            });
          }
        }
      });
    }

    // 2. Gym Alerts (Expiring Subscriptions & Unpaid Balances)
    if (canGym) {
      members.forEach(m => {
        if (m.id === 'walk_in' || m.id === 'system_walk_in' || m.isSystemWalkIn || m.memberType === 'ghost') return;
        const fullName = `${m.firstName || ''} ${m.lastName || ''}`.trim() || 'Member';

        if (m.expiryDate && m.status !== 'inactive' && !m.isFrozen) {
          const daysLeft = differenceInDays(new Date(m.expiryDate), now);
          if (daysLeft < 0 && daysLeft >= -14) {
            list.push({
              id: `gym-exp-${m.id}`,
              title: `Subscription Expired: ${fullName}`,
              description: `Membership expired on ${m.expiryDate}. Follow up for renewal.`,
              severity: 'critical',
              module: 'gym',
              targetPath: '/gym',
              timestamp: m.expiryDate,
              isUnsolvedOperational: true
            });
          } else if (daysLeft >= 0 && daysLeft <= 3) {
            list.push({
              id: `gym-exp-soon-${m.id}`,
              title: `Expiring in ${daysLeft}d: ${fullName}`,
              description: `Gym membership expires on ${m.expiryDate}.`,
              severity: 'warning',
              module: 'gym',
              targetPath: '/gym',
              timestamp: m.expiryDate,
              isUnsolvedOperational: true
            });
          }
        }

        const expected = Number(m.expectedFee || 0);
        const paid = Number(m.totalPaid || 0);
        const due = Math.max(0, expected - paid);
        if (m.billingStatus === 'unpaid' && due > 0.01) {
          list.push({
            id: `gym-unpaid-${m.id}`,
            title: `Unpaid Gym Dues: ${fullName}`,
            description: `Outstanding membership balance of ${formatCurrency(due)}.`,
            severity: 'warning',
            module: 'gym',
            targetPath: '/gym',
            timestamp: todayStr,
            isUnsolvedOperational: true
          });
        }
      });
    }

    // 3. Court Reservations Alerts (Today's Unpaid Bookings)
    if (canReservations) {
      bookings.forEach(b => {
        if (b.date === todayStr && b.status === 'booked') {
          const price = Number(b.rateApplied ?? b.price ?? 0);
          const paid = Number(b.paidAmount || 0);
          const remaining = Math.max(0, price - paid);
          if (remaining > 0) {
            list.push({
              id: `court-unpaid-${b.id}`,
              title: `Today's Unpaid Court: ${b.name || 'Guest'}`,
              description: `${(b.court || 'basketball').toUpperCase()} (${b.startTime || b.time}) • Due: ${formatCurrency(remaining)}`,
              severity: 'info',
              module: 'reservations',
              targetPath: '/reservations',
              timestamp: todayStr,
              isUnsolvedOperational: true
            });
          }
        }
      });
    }

    // 4. Accounting Alerts (Pending Expenses & Unposted Mode B Entries)
    if (canAccounting) {
      const pendingExpenses = expenses.filter(e => e.status === 'pending');
      if (pendingExpenses.length > 0) {
        const totalPendingExp = pendingExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
        list.push({
          id: `pending-exp-${pendingExpenses.length}`,
          title: `${pendingExpenses.length} Pending Supplier Expense(s)`,
          description: `Total unpaid supplier payables awaiting settlement: ${formatCurrency(totalPendingExp)}.`,
          severity: 'warning',
          module: 'accounting',
          targetPath: '/accounting',
          timestamp: todayStr,
          isUnsolvedOperational: true
        });
      }

      const unpostedEntries = advTxns.filter(
        t => !t.accountingStatus || t.accountingStatus === 'pending' || t.accountingStatus === 'unposted'
      );
      if (unpostedEntries.length > 0) {
        list.push({
          id: `unposted-tx-${unpostedEntries.length}`,
          title: `${unpostedEntries.length} Unposted Ledger Entries`,
          description: `Entries waiting in the Posting Queue to be reviewed and posted to Mode B GL.`,
          severity: 'info',
          module: 'accounting',
          targetPath: '/accounting',
          timestamp: todayStr,
          isUnsolvedOperational: true
        });
      }
    }

    // Sort by severity: critical -> warning -> info
    const weight = { critical: 0, warning: 1, info: 2 };
    return list.sort((a, b) => weight[a.severity] - weight[b.severity]);
  }, [canPos, canGym, canReservations, canAccounting, inventory, members, bookings, expenses, advTxns, formatCurrency]);

  const alerts = useMemo(() => {
    return rawAlerts.filter(a => !notifState.dismissedIds.includes(a.id));
  }, [rawAlerts, notifState.dismissedIds]);

  const seenIds = notifState.seenIds;
  const clickedIds = notifState.clickedIds;

  const newCount = useMemo(() => {
    return alerts.filter(a => !seenIds.includes(a.id)).length;
  }, [alerts, seenIds]);

  const handleToggleOpen = () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen && alerts.length > 0) {
      const allActiveIds = alerts.map(a => a.id);
      const mergedSeen = Array.from(new Set([...seenIds, ...allActiveIds]));
      persistNotifState({
        ...notifState,
        seenIds: mergedSeen
      });
    }
  };

  const markAllAsRead = () => {
    const allIds = alerts.map(a => a.id);
    persistNotifState({
      ...notifState,
      seenIds: Array.from(new Set([...seenIds, ...allIds])),
      clickedIds: Array.from(new Set([...clickedIds, ...allIds]))
    });
  };

  const handleSelectAlert = (alert: NotificationAlert) => {
    const nextSeen = Array.from(new Set([...seenIds, alert.id]));
    const nextClicked = Array.from(new Set([...clickedIds, alert.id]));
    const nextDismissed = !alert.isUnsolvedOperational
      ? Array.from(new Set([...notifState.dismissedIds, alert.id]))
      : notifState.dismissedIds;

    persistNotifState({
      seenIds: nextSeen,
      clickedIds: nextClicked,
      dismissedIds: nextDismissed
    });
    setIsOpen(false);
    navigate(alert.targetPath);
  };

  const handleDismissInfoAlert = (e: React.MouseEvent, alertId: string) => {
    e.stopPropagation();
    persistNotifState({
      ...notifState,
      seenIds: Array.from(new Set([...seenIds, alertId])),
      dismissedIds: Array.from(new Set([...notifState.dismissedIds, alertId]))
    });
  };

  const getModuleIcon = (mod: NotificationAlert['module']) => {
    switch (mod) {
      case 'pos': return <Package size={14} />;
      case 'gym': return <Dumbbell size={14} />;
      case 'reservations': return <Calendar size={14} />;
      case 'accounting': return <BarChart3 size={14} />;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleToggleOpen}
        className={`h-9 w-9 inline-flex items-center justify-center rounded-lg border transition-colors relative ${
          isDarkMode
            ? 'bg-[#0B0F17] border-zinc-800 text-zinc-400 hover:border-[#00B8C8]/50 hover:text-[#00B8C8]'
            : 'bg-white border-slate-200 text-slate-600 hover:border-[#00B8C8]/60 hover:text-[#0099A8]'
        }`}
        title="Notifications"
      >
        <Bell size={16} />
        {newCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 bg-rose-600 text-white text-[9px] font-black rounded-full flex items-center justify-center shadow-sm">
            {newCount > 99 ? '99+' : newCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className={`absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border shadow-2xl z-50 overflow-hidden ${
            isDarkMode ? 'bg-[#101622] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
          }`}
        >
          <div className={`px-4 py-3 border-b flex items-center justify-between ${
            isDarkMode ? 'border-zinc-800 bg-[#0B0F17]' : 'border-slate-200 bg-slate-50'
          }`}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-widest">Operational Alerts</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#00B8C8]/10 text-[#0099A8] dark:text-[#00B8C8] border border-[#00B8C8]/20">
                {alerts.length} Active
              </span>
            </div>
            {alerts.some(a => !clickedIds.includes(a.id)) && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1 text-[10px] font-bold text-[#0099A8] dark:text-[#00B8C8] hover:opacity-80 transition-opacity"
              >
                <CheckCheck size={13} />
                Mark All Visited
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-slate-200 dark:divide-zinc-800/60">
            {alerts.length === 0 ? (
              <div className="p-8 text-center">
                <Bell size={28} className="mx-auto mb-2 text-zinc-400 opacity-40" />
                <p className="text-xs font-bold text-zinc-500">All clear! No active alerts for your role.</p>
              </div>
            ) : (
              alerts.map(alert => {
                const isSeen = seenIds.includes(alert.id);
                const isClicked = clickedIds.includes(alert.id);
                return (
                  <div
                    key={alert.id}
                    onClick={() => handleSelectAlert(alert)}
                    className={`w-full text-left p-3.5 transition-colors flex items-start gap-3 cursor-pointer ${
                      isDarkMode ? 'hover:bg-[#0B0F17]/80' : 'hover:bg-slate-50'
                    } ${isClicked ? 'opacity-70' : ''}`}
                  >
                    <div className={`mt-0.5 p-2 rounded-xl shrink-0 ${
                      alert.severity === 'critical'
                        ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                        : alert.severity === 'warning'
                        ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                        : 'bg-[#00B8C8]/10 text-[#00B8C8] border border-[#00B8C8]/25'
                    }`}>
                      {alert.severity === 'critical' ? (
                        <AlertCircle size={15} />
                      ) : alert.severity === 'warning' ? (
                        <AlertTriangle size={15} />
                      ) : (
                        <Info size={15} />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded flex items-center gap-1 ${
                          alert.severity === 'critical'
                            ? 'bg-rose-500/15 text-rose-500'
                            : alert.severity === 'warning'
                            ? 'bg-amber-500/15 text-amber-500'
                            : 'bg-[#00B8C8]/15 text-[#0099A8] dark:text-[#00B8C8]'
                        }`}>
                          {getModuleIcon(alert.module)}
                          {alert.severity}
                        </span>
                        {!isSeen ? (
                          <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            NEW
                          </span>
                        ) : isClicked ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400 border border-zinc-700/80">
                            Visited • Pending Resolution
                          </span>
                        ) : (
                          <span className="text-[9px] font-semibold text-zinc-500">
                            Pending Resolution
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-bold truncate mt-1">{alert.title}</p>
                      <p className="text-[11px] text-zinc-500 line-clamp-2 mt-0.5">{alert.description}</p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 mt-1">
                      {alert.severity === 'info' && (
                        <button
                          type="button"
                          onClick={(e) => handleDismissInfoAlert(e, alert.id)}
                          title="Dismiss alert"
                          className="p-1 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-zinc-800/60 transition-colors"
                        >
                          <X size={13} />
                        </button>
                      )}
                      <ExternalLink size={13} className="text-zinc-400" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

