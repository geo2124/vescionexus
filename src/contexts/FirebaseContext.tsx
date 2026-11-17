import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut, setPersistence, browserLocalPersistence, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDocFromServer, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { OperationType, FirestoreErrorInfo } from '../types';
import { captureDiagnosticError, setDiagnosticUserContext } from '../lib/sentry';

export interface UserPermissions {
  reservations: boolean;
  gym: boolean;
  coupons: boolean;
  cashback: boolean;
  physio: boolean;
  members: boolean;
  pos: boolean;
  staff: boolean;
  hr: boolean;
  analytics: boolean;
  settings: boolean;
  accounting: boolean;
  accountingAccess?: 'none' | 'real_time' | 'posting' | 'both';
}

export interface UserProfile {
  uid: string;
  username: string;
  role: 'admin' | 'staff';
  permissions: UserPermissions;
}

export interface TaxRule {
  enabled: boolean;
  rate: number; // e.g. 11 for 11%
  name: string; // e.g. "VAT"
  inclusive: boolean;
}

export interface TaxRules {
  USD: TaxRule;
  LBP: TaxRule;
}

export const defaultTaxRules: TaxRules = {
  USD: { enabled: false, rate: 0, name: 'VAT (USD)', inclusive: false },
  LBP: { enabled: false, rate: 11, name: 'TVA (LBP)', inclusive: false }
};

interface FirebaseContextType {
  user: User | null;
  currentUser: User | null;
  userProfile: UserProfile | null;
  userRole: string;
  globalSettings: Record<string, any>;
  loading: boolean;
  authLoading: boolean;
  isAuthReady: boolean;
  login: () => Promise<void>;
  loginWithCredentials: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  currency: 'USD' | 'LBP';
  usdToLbpRate: number;
  taxRules: TaxRules;
  accountingMode: 'real_time' | 'batch_manual';
  adjustmentPercentage: number;
  systemName: string;
  systemLogo: string | null;
  mofTaxId: string;
  closedPeriods: string[];
  enabledModules: Record<string, boolean>;
  isModuleEnabled: (moduleKey: string) => boolean;
  updateEnabledModules: (updates: Record<string, boolean>) => Promise<void>;
  isPeriodClosed: (date: Date | string) => boolean;
  formatCurrency: (amountInUSD: number) => string;
  convertToBase: (amount: number) => number;
  convertFromBase: (amountInUSD: number) => number;
  handleFirestoreError: (error: unknown, operationType: OperationType, path: string | null) => void;
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

export const DEFAULT_ENABLED_MODULES: Record<string, boolean> = {
  master_calendar: true,
  members: true,
  gym: true,
  reservations: true,
  physio: true,
  pos_cafeteria: true,
  cafeteria_pos: true,
  pos_retail: true,
  retail_pos: true,
  staff: true,
  hr: true,
  accounting: true,
  coupons: true,
  cashback: true,
  settings: true
};

const defaultAdminPermissions: UserPermissions = {
  reservations: true,
  gym: true,
  coupons: true,
  cashback: true,
  physio: true,
  members: true,
  pos: true,
  staff: true,
  hr: true,
  analytics: true,
  settings: true,
  accounting: true,
  accountingAccess: 'both',
};

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [globalSettings, setGlobalSettings] = useState<Record<string, any>>({ managerPin: '1234' });
  const [enabledModules, setEnabledModules] = useState<Record<string, boolean>>(DEFAULT_ENABLED_MODULES);
  const [loading, setLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [currency, setCurrency] = useState<'USD' | 'LBP'>('USD');
  const [usdToLbpRate, setUsdToLbpRate] = useState<number>(90000);
  const [taxRules, setTaxRules] = useState<TaxRules>(defaultTaxRules);
  const [accountingMode, setAccountingMode] = useState<'real_time' | 'batch_manual'>('real_time');
  const [adjustmentPercentage, setAdjustmentPercentage] = useState<number>(0);
  const [systemName, setSystemName] = useState<string>('Vescio Nexus');
  const [systemLogo, setSystemLogo] = useState<string | null>(null);
  const [mofTaxId, setMofTaxId] = useState<string>('MOF-3891042-601');
  const [closedPeriods, setClosedPeriods] = useState<string[]>([]);

  const isModuleEnabled = (moduleKey: string): boolean => {
    if (moduleKey === 'members' || moduleKey === 'settings') return true;
    if (moduleKey === 'cafeteria_pos' || moduleKey === 'pos_cafeteria' || moduleKey === 'pos_cafe') {
      return enabledModules.pos_cafeteria !== false && enabledModules.cafeteria_pos !== false;
    }
    if (moduleKey === 'retail_pos' || moduleKey === 'pos_retail') {
      return enabledModules.pos_retail !== false && enabledModules.retail_pos !== false;
    }
    if (moduleKey === 'courts' || moduleKey === 'reservations' || moduleKey === 'reservation') {
      return enabledModules.reservations !== false;
    }
    return enabledModules[moduleKey] !== false;
  };

  const updateEnabledModules = async (updates: Record<string, boolean>) => {
    const normalized: Record<string, boolean> = { ...enabledModules, ...updates, members: true, settings: true };
    if ('pos_cafeteria' in updates) normalized.cafeteria_pos = updates.pos_cafeteria;
    if ('cafeteria_pos' in updates) normalized.pos_cafeteria = updates.cafeteria_pos;
    if ('pos_retail' in updates) normalized.retail_pos = updates.pos_retail;
    if ('retail_pos' in updates) normalized.pos_retail = updates.retail_pos;
    setEnabledModules(normalized);
    await setDoc(doc(db, 'system', 'settings'), { enabledModules: normalized }, { merge: true });
  };

  const isPeriodClosed = (dateInput: Date | string) => {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return false;
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return closedPeriods.includes(yearMonth);
  };

  const convertToBase = (amount: number) => {
    if (currency === 'LBP') {
      return usdToLbpRate > 0 ? amount / usdToLbpRate : amount;
    }
    return amount;
  };

  const convertFromBase = (amountInUSD: number) => {
    if (currency === 'LBP') {
      return amountInUSD * usdToLbpRate;
    }
    return amountInUSD;
  };

  const formatCurrency = (amountInUSD: number) => {
    const amount = convertFromBase(amountInUSD);
    if (currency === 'LBP') {
      return `ل.ل ${Math.round(amount).toLocaleString()}`;
    }
    return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData?.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoURL: provider.photoURL,
        })) || []
      },
      operationType,
      path
    }
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    captureDiagnosticError(
      error instanceof Error ? error : new Error(String(error)),
      {
        operationType,
        path,
        authInfo: errInfo.authInfo,
        role: userProfile?.role || 'staff',
        branchId: (userProfile as any)?.branchId || globalSettings?.branchId || 'main',
      },
      'firestore'
    );
    throw new Error(JSON.stringify(errInfo));
  };

  useEffect(() => {
    if (user) {
      setDiagnosticUserContext({
        uid: user.uid,
        email: user.email,
        role: userProfile?.role || 'staff',
        branchId: (userProfile as any)?.branchId || globalSettings?.branchId || 'main',
      });
    } else {
      setDiagnosticUserContext(null);
    }
  }, [user, userProfile, globalSettings?.branchId]);

  useEffect(() => {
    let unsubSystemSettings: (() => void) | undefined;

    setPersistence(auth, browserLocalPersistence)
      .then(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
          setUser(currentUser);
          if (currentUser) {
            setDiagnosticUserContext({
              uid: currentUser.uid,
              email: currentUser.email,
              role: 'staff',
              branchId: 'main',
            });
            // Subscribe to settings only when authenticated
            unsubSystemSettings = onSnapshot(doc(db, 'system', 'settings'), (docSnap) => {
              if (docSnap.exists()) {
                const data = docSnap.data();
                setGlobalSettings({ managerPin: data.managerPin || '1234', ...data });
                const rawName = (data.systemName || data.complexName || '').trim();
                if (!rawName || rawName === 'Elite OS' || rawName === 'Up ERP') {
                  setSystemName('Vescio Nexus');
                } else {
                  setSystemName(rawName);
                }
                if (data.systemLogo) {
                  setSystemLogo(data.systemLogo);
                } else {
                  setSystemLogo(null);
                }
                if (data.currency === 'LBP') {
                  setCurrency('LBP');
                } else {
                  setCurrency('USD');
                }
                if (typeof data.usdToLbpRate === 'number') {
                  setUsdToLbpRate(data.usdToLbpRate);
                }
                if (data.taxRules) {
                  setTaxRules({
                    USD: { ...defaultTaxRules.USD, ...data.taxRules.USD },
                    LBP: { ...defaultTaxRules.LBP, ...data.taxRules.LBP }
                  });
                }
                if (data.accountingMode) {
                  setAccountingMode(data.accountingMode);
                }
                if (typeof data.adjustmentPercentage === 'number') {
                  setAdjustmentPercentage(data.adjustmentPercentage);
                }
                if (data.closedPeriods && Array.isArray(data.closedPeriods)) {
                  setClosedPeriods(data.closedPeriods);
                }
                if (typeof data.mofTaxId === 'string' && data.mofTaxId.trim()) {
                  setMofTaxId(data.mofTaxId.trim());
                }
                if (data.enabledModules && typeof data.enabledModules === 'object') {
                  setEnabledModules({
                    ...DEFAULT_ENABLED_MODULES,
                    ...data.enabledModules,
                    members: true,
                    settings: true
                  });
                }
              }
            }, (snapErr) => {
              captureDiagnosticError(snapErr, { operationType: 'get', path: 'system/settings' }, 'firestore');
            });

            try {
              const profileDoc = await getDoc(doc(db, 'staff', currentUser.uid));
              const isMainAdmin = currentUser.email === 'admin@eliteos.com' || currentUser.email === 'geogo3@gmail.com' || currentUser.email?.toLowerCase() === 'jess.chakh22@gmail.com';
              
              if (profileDoc.exists()) {
                const data = profileDoc.data() as UserProfile;
                if (isMainAdmin || data.role === 'admin') {
                  const updatedProfile: UserProfile = {
                    ...data,
                    role: 'admin',
                    permissions: { ...defaultAdminPermissions }
                  };
                  if (data.role !== 'admin' || !data.permissions?.accounting) {
                    await setDoc(doc(db, 'staff', currentUser.uid), updatedProfile);
                  }
                  setUserProfile(updatedProfile);
                } else {
                  const rawPerms: any = data.permissions || {};
                  const normalizedPerms: UserPermissions = {
                    reservations: !!rawPerms.reservations,
                    gym: !!rawPerms.gym,
                    coupons: !!rawPerms.coupons,
                    cashback: !!rawPerms.cashback,
                    physio: !!rawPerms.physio,
                    members: rawPerms.members !== undefined ? !!rawPerms.members : true,
                    pos: !!rawPerms.pos,
                    staff: !!rawPerms.staff,
                    hr: !!rawPerms.hr,
                    analytics: !!rawPerms.analytics,
                    settings: !!rawPerms.settings,
                    accounting: !!rawPerms.accounting,
                    accountingAccess: rawPerms.accounting
                      ? (rawPerms.accountingAccess || 'real_time')
                      : 'none'
                  };
                  setUserProfile({ ...data, permissions: normalizedPerms });
                }
              } else {
                // Fallback for newly created admin or Google users
                const newProfile: UserProfile = {
                  uid: currentUser.uid,
                  username: isMainAdmin ? 'admin' : currentUser.email?.split('@')[0] || 'user',
                  role: isMainAdmin ? 'admin' : 'staff',
                  permissions: isMainAdmin ? defaultAdminPermissions : {
                    reservations: false, gym: false, coupons: false, cashback: false,
                    physio: false, members: false, pos: false, staff: false,
                    hr: false, analytics: false, settings: false, accounting: false,
                    accountingAccess: 'none'
                  }
                };
                await setDoc(doc(db, 'staff', currentUser.uid), newProfile);
                setUserProfile(newProfile);
              }
            } catch (error) {
              console.error("Error fetching user profile:", error);
              captureDiagnosticError(error, { operationType: 'get', path: `staff/${currentUser.uid}` }, 'firestore');
            }
          } else {
            setDiagnosticUserContext(null);
            setUserProfile(null);
            if (unsubSystemSettings) {
              unsubSystemSettings();
              unsubSystemSettings = undefined;
            }
          }
          setIsAuthReady(true);
          setLoading(false);
        });
        
        return () => {
          unsubscribe();
          if (unsubSystemSettings) {
             unsubSystemSettings();
          }
        };
      })
      .catch((error) => {
        console.error("Auth persistence error:", error);
        captureDiagnosticError(error, { stage: 'setPersistence' }, 'firebase_auth');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const testConnection = async () => {
      try {
        // Test connection to Firestore
        await getDocFromServer(doc(db, '_connection_test_', 'ping'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline.");
        }
        // Other errors are expected if the document doesn't exist or permissions are denied
      }
    };
    testConnection();
  }, []);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const loginWithCredentials = async (username: string, password: string) => {
    // Map username to email for Firebase Auth
    const email = username === 'admin' ? 'admin@eliteos.com' : `${username}@eliteos.com`;
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        // If the main admin doesn't exist yet, create it
        if (username === 'admin' && password === 'admin123') {
          await createUserWithEmailAndPassword(auth, email, password);
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  const resolvedUserRole = userProfile?.role || 'staff';

  return (
    <FirebaseContext.Provider value={{ user, currentUser: user, userProfile, userRole: resolvedUserRole, globalSettings, loading, authLoading: loading, isAuthReady, login, loginWithCredentials, logout, currency, usdToLbpRate, taxRules, accountingMode, adjustmentPercentage, systemName, systemLogo, mofTaxId, closedPeriods, enabledModules, isModuleEnabled, updateEnabledModules, isPeriodClosed, formatCurrency, convertToBase, convertFromBase, handleFirestoreError }}>
      {children}
    </FirebaseContext.Provider>
  );
};

export const useFirebase = () => {
  const context = useContext(FirebaseContext);
  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return context;
};
