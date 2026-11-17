import { 
  collection, 
  doc, 
  getDocs,
  query,
  where,
  runTransaction, 
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../firebase';

export type SourceModule =
  | 'pos_retail'
  | 'pos_cafe'
  | 'pos_cafeteria'
  | 'gym'
  | 'reservation'
  | 'physio'
  | 'expenses'
  | 'invoicing'
  | 'payroll'
  | 'member_management'
  | 'cashback_credit'
  | string;

export interface CheckoutItem {
  itemId: string;
  name: string;
  nameAr?: string;
  quantity: number;
  price: number;
  priceLBP?: number;
  saleUnitType?: 'unit' | 'pack';
  unitsDeductedPerQty?: number;
  variantId?: string;
  variantName?: string;
  isBundle?: boolean;
  bundleComponents?: { itemId: string; itemName?: string; name?: string; quantity: number }[];
}

export interface AtomicCheckoutPayload {
  memberId?: string | null;
  memberName?: string | null;
  memberPhone?: string | null;
  items: CheckoutItem[];
  subtotal: number;
  discount: number;
  manualDiscount?: number;
  couponDiscount?: number;
  taxAmount?: number;
  applyVat?: boolean;
  total: number;
  paymentMethod: string;
  splitBreakdown?: {
    wallet: number;
    cash: number;
    card: number;
  } | null;
  shiftId?: string | null;
  cashierName?: string | null;
  tenderedUSD?: number;
  tenderedLBP?: number;
  changeUSD?: number;
  changeLBP?: number;
  exchangeRateUsed?: number;
  sourceModule: SourceModule; // e.g., 'pos_retail', 'pos_cafeteria', 'pos_cafe'
  cashierId: string;
  couponId?: string | null;
  couponCode?: string | null;
  cashbackCodeId?: string | null;
  notes?: string | null;
}

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    // Preserve Firestore FieldValue sentinels (increment, serverTimestamp, arrayUnion, deleteField, etc.)
    if (
      '_methodName' in (value as Record<string, unknown>) ||
      (value as Record<string, unknown>).constructor?.name !== 'Object'
    ) {
      return value;
    }
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        cleaned[k] = stripUndefined(v);
      }
    }
    return cleaned as T;
  }
  return value;
}

const createSafeTransactionProxy = (transaction: any) => ({
  get: (ref: any) => transaction.get(ref),
  set: (ref: any, data: any, options?: any) =>
    options !== undefined
      ? transaction.set(ref, stripUndefined(data), options)
      : transaction.set(ref, stripUndefined(data)),
  update: (ref: any, data: any, ...rest: any[]) =>
    transaction.update(ref, stripUndefined(data), ...rest),
  delete: (ref: any) => transaction.delete(ref)
});

export interface LedgerTransactionPayload {
  amount: number;
  subtotal?: number;
  discount?: number;
  paymentMethod: string;
  memberId?: string | null;
  sourceModule: SourceModule;
  cashierId: string;
  transactionType: string;
  referenceType?: string;
  sourceAccount?: string;
  destinationAccount?: string;
  referenceId?: string | null;
  relatedIds?: string[];
  notes?: string | null;
  direction?: 'inflow' | 'outflow' | 'audit';
  // Promo & Cashback specifics
  couponId?: string | null;
  couponCode?: string | null;
  cashbackCodeId?: string | null;
  rewardAmount?: number;
  // Analytical & Sub-Type metadata
  paidFromModule?: string | null;
  category?: string | null;
  bookingSubType?: string | null;
  individualAccessScope?: string | null;
  court?: string | null;
}

export type CustomTransactionAction = (transaction: any, preResult?: any) => Promise<void> | void;

export interface ReversalTransactionPayload {
  originalTransactionId?: string;
  originalTransactionIds?: string[];
  amount?: number; // Kept for backwards compat, but exact amounts will be pulled from original txns
  transactionType: string;
  sourceModule: SourceModule;
  cashierId: string;
  reason: string;
  memberId?: string | null;
  relatedIds?: string[];
  sourceAccount?: string;
  destinationAccount?: string; // where the money goes back (e.g., 531 - Cash Drawer, 419 - Member Wallet)
  restoreInventoryItems?: {
    itemId: string;
    quantity: number;
    saleUnitType?: 'unit' | 'pack';
    unitsDeductedPerQty?: number;
    variantId?: string;
    variantName?: string;
    isBundle?: boolean;
    bundleComponents?: { itemId: string; itemName?: string; name?: string; quantity: number }[];
  }[];
}

export const resolveDefaultInflowDebitAccount = (paymentMethod: string): string => {
  const pm = (paymentMethod || 'cash').toLowerCase();
  if (pm === 'cash') return '531 - Cash Drawer / Register (Caisse)';
  if (pm === 'card') return '512 - Bank / Card Terminal';
  if (pm === 'transfer' || pm === 'bank_transfer' || pm === 'bank') return '512 - Bank Accounts (Fresh USD / LBP)';
  if (pm === 'member_balance' || pm === 'wallet') return '419 - Member Wallet & Deposits Liability';
  if (pm === 'on_account' || pm === 'receivable' || pm === 'soa') return '411 - Clients / Member Accounts Receivable';
  if (pm === 'system') return 'system_audit';
  return `531 - Cash Drawer (${paymentMethod})`;
};

export const resolveDefaultRevenueCreditAccount = (sourceModule: SourceModule): string => {
  const mod = (sourceModule || '').toLowerCase();
  if (mod === 'gym' || mod === 'gym_checkin') return '7061 - Gym Membership & Training Revenue';
  if (mod === 'reservation' || mod === 'courts' || mod === 'court') return '7062 - Court Reservation Revenue';
  if (mod === 'physio') return '7063 - Physiotherapy Clinical Revenue';
  if (mod === 'pos_cafe' || mod === 'pos_cafeteria') return '701 - Kiosk POS Sales';
  if (mod === 'pos_retail') return '702 - Retail Shop POS Sales';
  if (mod === 'member_management') return '419 - Member Wallet & Deposits Liability';
  return '706 - General Facility Revenue';
};

/**
 * Universal wrapper for strictly non-POS ledger transactions (Reservations, Gym, Physio, Expenses).
 * Guarantees standard fields, atomicity, and permits injecting custom update logic (e.g. marking a booking as cashed_in).
 */
export const processLedgerTransaction = async (
  payload: LedgerTransactionPayload,
  customAction?: CustomTransactionAction,
  customPreAction?: (transaction: any) => Promise<any>
) => {
  return await runTransaction(db, async (rawTransaction) => {
    const transaction = createSafeTransactionProxy(rawTransaction);
    let preResult: any = null;
    if (customPreAction) {
      preResult = await customPreAction(transaction);
    }
    // 1b. Fetch current exchange rate & accounting mode for persistence
    const settingsRef = doc(db, 'system', 'settings');
    const globalSettingsRef = doc(db, 'settings', 'global');
    const [settingsDoc, globalSettingsDoc] = await Promise.all([
      transaction.get(settingsRef),
      transaction.get(globalSettingsRef)
    ]);
    const fxRateAtTimeOfTransaction = settingsDoc.exists()
      ? (settingsDoc.data().usdToLbpRate || 90000)
      : (globalSettingsDoc.exists() ? (globalSettingsDoc.data().exchangeRateLBP || 90000) : 90000);
    const accountingMode = globalSettingsDoc.exists()
      ? (globalSettingsDoc.data().accountingMode || 'posting')
      : (settingsDoc.exists() ? (settingsDoc.data().accountingMode || 'posting') : 'posting');
    const advInitialStatus = accountingMode === 'real_time' ? 'posted' : 'pending';

    // 2. Validate member, coupon, & apply reward/cashback (ALL READS BEFORE WRITES)
    let couponRef: any = null;
    let couponData: any = null;
    let resolvedCouponCode: string | null = payload.couponCode || null;

    const isKioskPOSModule =
      payload.sourceModule === 'pos_cafe' ||
      payload.sourceModule === 'pos_cafeteria' ||
      payload.sourceModule === ('cafeteria' as any);

    if (payload.couponId && !isKioskPOSModule) {
      couponRef = doc(db, 'coupons', payload.couponId);
      const couponDoc = await transaction.get(couponRef);
      if (!couponDoc.exists()) {
        throw new Error('Coupon is invalid or no longer exists.');
      }
      couponData = couponDoc.data();
      if (couponData.isActive === false) {
        throw new Error(`Coupon '${couponData.code}' is currently inactive.`);
      }
      if (couponData.expiryDate && new Date(couponData.expiryDate).getTime() < Date.now()) {
        throw new Error(`Coupon '${couponData.code}' has expired.`);
      }
      if (couponData.usageLimit > 0 && (couponData.usageCount || 0) >= couponData.usageLimit) {
        throw new Error(`Coupon '${couponData.code}' has reached its maximum usage limit.`);
      }
      if (couponData.applicableModules && Array.isArray(couponData.applicableModules) && couponData.applicableModules.length > 0) {
        const mod = payload.sourceModule;
        const allowed = couponData.applicableModules;
        const isAllowed =
          allowed.includes(mod) ||
          (mod === 'reservation' && allowed.includes('courts')) ||
          (mod === 'courts' && allowed.includes('reservation')) ||
          (mod === 'pos_retail' && allowed.includes('pos'));
        if (!isAllowed) {
          throw new Error(`Coupon '${couponData.code}' is not valid for the ${mod} module.`);
        }
      }
      resolvedCouponCode = couponData.code || resolvedCouponCode;
    }

    let cashbackCodeString = isKioskPOSModule ? null : resolvedCouponCode;
    let finalReward = isKioskPOSModule ? 0 : (payload.rewardAmount || 0);
    let cbRef: any = null;
    let cbData: any = null;

    if (payload.cashbackCodeId && !isKioskPOSModule) {
      cbRef = doc(db, 'cashbackCodes', payload.cashbackCodeId);
      const cbDoc = await transaction.get(cbRef);
      if (!cbDoc.exists()) {
        throw new Error('Cashback code invalid or missing during processing.');
      }
      cbData = cbDoc.data();

      if (cbData.isActive === false) {
        throw new Error('This cashback code is currently inactive.');
      }
      if (cbData.expiryDate && new Date(cbData.expiryDate).getTime() < Date.now()) {
        throw new Error('This cashback code has expired.');
      }
      if (cbData.maxUses > 0 && (cbData.usageCount || 0) >= cbData.maxUses) {
        throw new Error('This cashback code has reached its maximum usage limit.');
      }
      if (cbData.memberId && cbData.memberId !== payload.memberId) {
        throw new Error('This reward code is assigned to another member.');
      }
      if (cbData.applicableModules && Array.isArray(cbData.applicableModules) && cbData.applicableModules.length > 0) {
        const mod = payload.sourceModule;
        const allowed = cbData.applicableModules;
        const isAllowed =
          allowed.includes(mod) ||
          (mod === 'reservation' && allowed.includes('courts')) ||
          (mod === 'courts' && allowed.includes('reservation')) ||
          (mod === 'pos_retail' && allowed.includes('pos'));
        if (!isAllowed) {
          throw new Error(`This reward code is not applicable to the ${mod} module.`);
        }
      }

      cashbackCodeString = cbData.code;
      if (!finalReward) {
        if (cbData.cashbackType === 'percentage') finalReward = payload.amount * ((cbData.value || 0) / 100);
        else finalReward = cbData.value || 0;
      }
    }

    let memberRef: any = null;
    let memberDoc: any = null;
    let balanceChange = 0;

    if (payload.memberId) {
      if (payload.paymentMethod === 'member_balance') {
        balanceChange -= payload.amount;
      }
      if (finalReward > 0) {
        balanceChange += finalReward;
      }
      if (balanceChange !== 0) {
        memberRef = doc(db, 'members', payload.memberId);
        memberDoc = await transaction.get(memberRef);
      }
    }

    // Write Phase for processLedgerTransaction
    if (couponRef && couponData) {
      transaction.update(couponRef, { usageCount: (couponData.usageCount || 0) + 1 });
    }

    if (cbRef && cbData) {
      transaction.update(cbRef, { usageCount: (cbData.usageCount || 0) + 1 });
    }

    if (memberRef && memberDoc && memberDoc.exists()) {
      const currentBalance = memberDoc.data().balance || 0;
      if (currentBalance + balanceChange < 0) {
        throw new Error('Insufficient member balance.');
      }
      transaction.update(memberRef, { balance: currentBalance + balanceChange });
    }

    // 3. Write Core Ledger Transaction safely
    const txnRef = doc(collection(db, 'transactions'));
    const advancedTxnRef = doc(db, 'advanced_transactions', txnRef.id);
    
    const resolvedDirection = payload.direction || (payload.amount > 0 ? 'inflow' : (payload.amount < 0 ? 'outflow' : 'audit'));
    const sAcc = payload.sourceAccount || (
      resolvedDirection === 'inflow'
        ? resolveDefaultInflowDebitAccount(payload.paymentMethod)
        : (payload.paymentMethod === 'member_balance' ? '419 - Member Wallet & Deposits Liability' : payload.paymentMethod === 'system' ? 'system_audit' : '628 - General Operational Expense')
    );
    const dAcc = payload.destinationAccount || (
      resolvedDirection === 'inflow'
        ? resolveDefaultRevenueCreditAccount(payload.sourceModule)
        : (payload.amount < 0 || resolvedDirection === 'outflow' ? resolveDefaultInflowDebitAccount(payload.paymentMethod) : 'ledger_audit')
    );

    const txnData = stripUndefined({
      amount: payload.amount,
      subtotal: payload.subtotal ?? payload.amount,
      discount: payload.discount ?? 0,
      total: payload.amount,
      paymentMethod: payload.paymentMethod,
      memberId: payload.memberId || null,
      sourceModule: payload.sourceModule,
      cashierId: payload.cashierId,
      createdAt: serverTimestamp(),
      direction: resolvedDirection,
      transactionType: payload.transactionType,
      referenceType: payload.referenceType || payload.transactionType,
      sourceAccount: sAcc,
      destinationAccount: dAcc,
      referenceId: payload.referenceId || null,
      relatedIds: [...(payload.relatedIds || []), payload.memberId, payload.cashbackCodeId, payload.couponId, resolvedCouponCode].filter(Boolean),
      notes: payload.notes || null,
      couponId: payload.couponId || null,
      couponCode: resolvedCouponCode || cashbackCodeString,
      cashbackCodeId: payload.cashbackCodeId || null,
      paidFromModule: payload.paidFromModule || undefined,
      category: payload.category || undefined,
      bookingSubType: payload.bookingSubType || undefined,
      individualAccessScope: payload.individualAccessScope || undefined,
      court: payload.court || undefined,
      fxRateAtTimeOfTransaction,
      accountingStatus: 'posted'
    });
    
    transaction.set(txnRef, txnData);
    transaction.set(advancedTxnRef, { ...txnData, accountingStatus: advInitialStatus });

    // 4. Create separate secondary Cashback Inflow Transaction
    if (finalReward > 0 && payload.memberId) {
      const rewardTxnRef = doc(collection(db, 'transactions'));
      const advancedRewardTxnRef = doc(db, 'advanced_transactions', rewardTxnRef.id);
      
      const rewardData = {
        amount: finalReward,
        subtotal: finalReward,
        discount: 0,
        total: finalReward,
        paymentMethod: 'system',
        memberId: payload.memberId,
        sourceModule: 'cashback_credit',
        cashierId: payload.cashierId,
        createdAt: serverTimestamp(),
        direction: 'outflow',
        transactionType: 'cashback_credit',
        sourceAccount: '709 - Promotional Rewards & Cashback Contra',
        destinationAccount: '419 - Member Wallet & Deposits Liability',
        referenceId: txnRef.id,
        notes: `Cashback reward from code ${cashbackCodeString}`,
        couponCode: cashbackCodeString,
        cashbackCodeId: payload.cashbackCodeId,
        fxRateAtTimeOfTransaction,
        accountingStatus: 'posted'
      };
      transaction.set(rewardTxnRef, rewardData);
      transaction.set(advancedRewardTxnRef, { ...rewardData, accountingStatus: advInitialStatus });
    }

    // 5. Execute consumer's internal writes (must be after all reads)
    if (customAction) {
      await customAction(transaction, preResult);
    }

    return {
      success: true,
      transactionId: txnRef.id
    };
  });
};

/**
 * Reusable Firestore transaction engine for Elite OS.
 * Guarantees ATOMIC operations for finance, inventory, and order creation.
 */
export const processAtomicCheckout = async (payload: AtomicCheckoutPayload) => {
  return await runTransaction(db, async (rawTransaction) => {
    const transaction = createSafeTransactionProxy(rawTransaction);
    // ==========================================
    // 1. READ PHASE (All reads must happen first)
    // ==========================================
    
    // Read Member Document
    let memberRef = null;
    let memberDoc = null;

    if (payload.memberId) {
      memberRef = doc(db, 'members', payload.memberId);
      memberDoc = await transaction.get(memberRef);
    }

    // Read Cashback Code
    let cashbackCodeRef = null;
    let cashbackCodeDoc = null;
    if (payload.cashbackCodeId) {
      cashbackCodeRef = doc(db, 'cashbackCodes', payload.cashbackCodeId);
      cashbackCodeDoc = await transaction.get(cashbackCodeRef);
    }

    // Read Inventory Documents (including any combo bundle component items)
    const uniqueInvIds = Array.from(
      new Set([
        ...payload.items.map(item => item.itemId),
        ...payload.items.flatMap(item => (item.bundleComponents || []).map(bc => bc.itemId))
      ])
    ).filter(Boolean);

    const invDocsList = await Promise.all(uniqueInvIds.map(id => transaction.get(doc(db, 'inventory', id))));
    const invDocMap = new Map<string, any>();
    invDocsList.forEach(d => {
      if (d.exists()) {
        invDocMap.set(d.id, { id: d.id, ...d.data() });
      }
    });

    // Read FX Rate & Accounting Mode
    const settingsRef = doc(db, 'system', 'settings');
    const globalSettingsRef = doc(db, 'settings', 'global');
    const [settingsDoc, globalSettingsDoc] = await Promise.all([
      transaction.get(settingsRef),
      transaction.get(globalSettingsRef)
    ]);
    const baseFxRate = settingsDoc.exists()
      ? (settingsDoc.data().usdToLbpRate || 90000)
      : (globalSettingsDoc.exists() ? (globalSettingsDoc.data().exchangeRateLBP || 90000) : 90000);
    const fxRateAtTimeOfTransaction =
      Number(payload.exchangeRateUsed) > 0 ? Number(payload.exchangeRateUsed) : baseFxRate;
    const accountingMode = globalSettingsDoc.exists()
      ? (globalSettingsDoc.data().accountingMode || 'posting')
      : (settingsDoc.exists() ? (settingsDoc.data().accountingMode || 'posting') : 'posting');
    const advInitialStatus = accountingMode === 'real_time' ? 'posted' : 'pending';
    
    let couponRef = null;
    let couponDoc = null;
    let redemptionRef = null;
    let redemptionDoc = null;
    const targetCouponDocId = payload.couponId || payload.couponCode;

    if (targetCouponDocId) {
      couponRef = doc(db, 'coupons', targetCouponDocId);
      couponDoc = await transaction.get(couponRef);

      if (payload.memberId) {
        redemptionRef = doc(db, `coupons/${targetCouponDocId}/redemptions`, payload.memberId);
        redemptionDoc = await transaction.get(redemptionRef);
      }
    }

    // ==========================================
    // 2. VALIDATION & LOGIC PHASE
    // ==========================================

    // Validate Member Balance / On-Account / Split Payment
    if (payload.paymentMethod === 'member_balance') {
      if (!memberDoc || !memberDoc.exists()) {
        throw new Error('Member not found for balance checkout.');
      }
      const balance = memberDoc.data().balance || 0;
      if (balance < payload.total) {
        throw new Error(`Insufficient member balance. Available: $${balance.toFixed(2)}, Required: $${payload.total.toFixed(2)}`);
      }
    } else if (payload.paymentMethod === 'on_account') {
      if (!memberDoc || !memberDoc.exists()) {
        throw new Error('A registered member must be linked to charge an order On-Account (SOA Receivable).');
      }
      // On-Account (SOA) deliberately allows checkout even when member.balance === 0
    } else if (payload.paymentMethod === 'split') {
      if (!payload.splitBreakdown) {
        throw new Error('Split payment breakdown is required.');
      }
      const wPart = Math.max(0, Number(payload.splitBreakdown.wallet || 0));
      const cPart = Math.max(0, Number(payload.splitBreakdown.cash || 0));
      const dPart = Math.max(0, Number(payload.splitBreakdown.card || 0));
      const sumSplit = Number((wPart + cPart + dPart).toFixed(2));
      if (Math.abs(sumSplit - payload.total) > 0.02) {
        throw new Error(`Split payment breakdown ($${sumSplit.toFixed(2)}) must equal order total ($${payload.total.toFixed(2)}).`);
      }
      if (wPart > 0) {
        if (!memberDoc || !memberDoc.exists()) {
          throw new Error('A member must be selected to use Wallet balance in a split payment.');
        }
        const balance = memberDoc.data().balance || 0;
        if (balance < wPart) {
          throw new Error(`Insufficient member wallet balance for split payment. Available: $${balance.toFixed(2)}, Required: $${wPart.toFixed(2)}`);
        }
      }
    }

    // Validate Inventory Stock (Variants + Combo Bundles + Standard Items) & Calculate COGS
    const pendingInvUpdates = new Map<string, { stock: number; variants?: any[] }>();
    let totalCOGS = 0;

    const getMutableInvState = (invId: string) => {
      if (pendingInvUpdates.has(invId)) {
        return pendingInvUpdates.get(invId)!;
      }
      const baseData = invDocMap.get(invId);
      if (!baseData) return null;
      const state = {
        stock: Number(baseData.stock || 0),
        variants: Array.isArray(baseData.variants) ? baseData.variants.map((v: any) => ({ ...v })) : undefined
      };
      pendingInvUpdates.set(invId, state);
      return state;
    };

    payload.items.forEach((itemContext) => {
      const invData = invDocMap.get(itemContext.itemId);
      if (!invData) {
        throw new Error(`Item ${itemContext.name} not found in inventory.`);
      }

      const requiredQty = itemContext.quantity;
      const isBundleItem = Boolean(itemContext.isBundle || invData.isBundle);
      const bundleComps: { itemId: string; itemName: string; quantity: number }[] =
        itemContext.bundleComponents || invData.bundleComponents || [];

      if (isBundleItem && bundleComps.length > 0) {
        // Deduct each component's stock and accumulate component COGS
        bundleComps.forEach((comp) => {
          const compBase = invDocMap.get(comp.itemId);
          const compState = getMutableInvState(comp.itemId);
          if (!compBase || !compState) {
            throw new Error(`Bundle component "${comp.itemName}" not found in inventory.`);
          }
          const neededCompQty = (Number(comp.quantity) || 1) * requiredQty;
          if (compState.stock < neededCompQty) {
            throw new Error(`Insufficient component stock for "${comp.itemName}" in bundle "${itemContext.name}". Available: ${compState.stock}, Required: ${neededCompQty}`);
          }
          compState.stock -= neededCompQty;
          const compUnitCost = Number(compBase.costPrice ?? compBase.cost ?? 0);
          totalCOGS += compUnitCost * neededCompQty;
        });

        // Also decrement parent bundle stock if tracked (> 0)
        const bundleState = getMutableInvState(itemContext.itemId);
        if (bundleState && bundleState.stock >= requiredQty) {
          bundleState.stock -= requiredQty;
        }
      } else {
        const itemState = getMutableInvState(itemContext.itemId)!;
        const unitsDeductedPerQty = Math.max(
          1,
          Number(itemContext.unitsDeductedPerQty) ||
            (itemContext.saleUnitType === 'pack' ? Number(invData.unitsPerPack || 1) : 1)
        );
        const effectiveUnitsRequired = requiredQty * unitsDeductedPerQty;

        if (itemContext.variantId && itemState.variants && itemState.variants.length > 0) {
          const vIdx = itemState.variants.findIndex((v: any) => v.id === itemContext.variantId || v.name === itemContext.variantName);
          if (vIdx === -1) {
            throw new Error(`Variant "${itemContext.variantName || itemContext.variantId}" not found for ${itemContext.name}.`);
          }
          const vStock = Number(itemState.variants[vIdx].stock || 0);
          if (vStock < effectiveUnitsRequired) {
            throw new Error(`Insufficient stock for ${itemContext.name} (${itemState.variants[vIdx].name}). Available: ${vStock} units, Required: ${effectiveUnitsRequired} units`);
          }
          itemState.variants[vIdx].stock = vStock - effectiveUnitsRequired;
          itemState.stock = Math.max(0, itemState.stock - effectiveUnitsRequired);
        } else {
          if (itemState.stock < effectiveUnitsRequired) {
            throw new Error(`Insufficient stock for ${itemContext.name}. Available: ${itemState.stock} units, Required: ${effectiveUnitsRequired} units`);
          }
          itemState.stock -= effectiveUnitsRequired;
        }

        const unitCost = Number(
          invData.costPrice ??
            invData.cost ??
            (invData.packCostPrice && invData.unitsPerPack
              ? Number(invData.packCostPrice) / Math.max(1, Number(invData.unitsPerPack))
              : 0)
        );
        totalCOGS += unitCost * effectiveUnitsRequired;
      }
    });

    const isKioskCheckout =
      payload.sourceModule === 'pos_cafe' ||
      payload.sourceModule === 'pos_cafeteria' ||
      payload.sourceModule === ('cafeteria' as any);

    // Validate Cashback Code (Explicitly excluded for Kiosk POS)
    if (payload.cashbackCodeId && !isKioskCheckout && cashbackCodeRef && cashbackCodeDoc) {
      if (!cashbackCodeDoc.exists()) {
        throw new Error('Cashback code not found.');
      }
      const cbData = cashbackCodeDoc.data();
      if (!cbData.isActive) {
        throw new Error('This cashback code is currently inactive.');
      }
      if (cbData.expiryDate && new Date(cbData.expiryDate).getTime() < Date.now()) {
        throw new Error('This cashback code has expired.');
      }
      if (cbData.maxUses > 0 && (cbData.usageCount || 0) >= cbData.maxUses) {
        throw new Error('This cashback code has reached its maximum usage limit.');
      }
      
      // Target Member Validation
      if (cbData.memberId && cbData.memberId !== payload.memberId) {
        throw new Error('This reward code is assigned to another member.');
      }

      // Module Applicability Validation
      if (cbData.applicableModules && cbData.applicableModules.length > 0) {
        const rawMod = payload.sourceModule; // e.g., 'pos_retail'
        const allowed: string[] = cbData.applicableModules;
        const isAllowed =
          (rawMod === 'pos_retail' && allowed.includes('pos')) ||
          allowed.includes(rawMod);
        if (!isAllowed) {
          throw new Error(`This reward code is not applicable to the ${rawMod} module.`);
        }
      }

      if (!memberDoc || !memberDoc.exists()) {
        throw new Error('A valid member profile must be attached to redeem a cashback code.');
      }
    }

    // Validate Coupon (Explicitly excluded for Kiosk POS)
    if (targetCouponDocId && !isKioskCheckout && couponRef && couponDoc) {
      if (!couponDoc.exists()) {
        throw new Error(`Coupon code '${payload.couponCode || targetCouponDocId}' is invalid.`);
      }

      const couponData = couponDoc.data();

      if ((couponData.status && couponData.status !== 'active') || couponData.isActive === false) {
        throw new Error(`Coupon '${couponData.code || payload.couponCode}' is no longer active.`);
      }

      if (couponData.expiryDate && new Date(couponData.expiryDate).getTime() < Date.now()) {
        throw new Error(`Coupon '${couponData.code || payload.couponCode}' has expired.`);
      }

      if (couponData.usageLimit && (couponData.usageCount || 0) >= couponData.usageLimit) {
        throw new Error(`Coupon '${couponData.code || payload.couponCode}' has reached its maximum usage limit.`);
      }

      if (couponData.applicableModules && Array.isArray(couponData.applicableModules) && couponData.applicableModules.length > 0) {
        const rawMod = payload.sourceModule;
        const allowed: string[] = couponData.applicableModules;
        const isAllowed =
          (rawMod === 'pos_retail' && allowed.includes('pos')) ||
          allowed.includes(rawMod);
        if (!isAllowed) {
          throw new Error(`Coupon '${couponData.code || payload.couponCode}' is not applicable to ${rawMod}.`);
        }
      }

      if (payload.memberId && redemptionDoc && redemptionDoc.exists()) {
        throw new Error(`Coupon '${couponData.code || payload.couponCode}' has already been redeemed by this member.`);
      }
    }

    // ==========================================
    // 3. WRITE PHASE (No more reads allowed after here)
    // ==========================================

    // Calculate Cashback Reward
    let rewardAmount = 0;
    let cashbackCodeString = null;
    if (!isKioskCheckout && cashbackCodeDoc && cashbackCodeDoc.exists()) {
      const cbData = cashbackCodeDoc.data();
      cashbackCodeString = cbData.code;
      if (cbData.cashbackType === 'percentage') {
        rewardAmount = payload.total * ((cbData.value || 0) / 100);
      } else {
        rewardAmount = cbData.value || 0;
      }
      transaction.update(cashbackCodeRef!, { usageCount: (cbData.usageCount || 0) + 1 });
    }

    // Update Member Balance
    if (memberRef && memberDoc) {
      let balanceChange = 0;
      if (payload.paymentMethod === 'member_balance') {
        balanceChange -= payload.total;
      } else if (payload.paymentMethod === 'split' && payload.splitBreakdown && payload.splitBreakdown.wallet > 0) {
        balanceChange -= Number(payload.splitBreakdown.wallet);
      }
      if (rewardAmount > 0) {
        balanceChange += rewardAmount;
      }
      
      if (balanceChange !== 0) {
        const newBalance = (memberDoc.data().balance || 0) + balanceChange;
        transaction.update(memberRef, { balance: newBalance });
      }
    }

    // Update Inventory Stock (including variants and bundle components)
    pendingInvUpdates.forEach((state, invId) => {
      const invRef = doc(db, 'inventory', invId);
      const updatePayload: Record<string, any> = {
        stock: state.stock,
        updatedAt: new Date().toISOString()
      };
      if (state.variants) {
        updatePayload.variants = state.variants;
      }
      transaction.update(invRef, updatePayload);
    });

    // Update Coupon Usage and Record Redemption
    if (targetCouponDocId && couponRef && couponDoc && couponDoc.exists()) {
      const newUsageCount = (couponDoc.data().usageCount || 0) + 1;
      transaction.update(couponRef, { usageCount: newUsageCount });
    }

    // Pre-generate Transaction and Order Refs to link everything atomically
    const orderRef = doc(collection(db, 'orders'));
    const txnRef = doc(collection(db, 'transactions'));
    const advancedTxnRef = doc(db, 'advanced_transactions', txnRef.id);

    const resolvedPosCouponCode = couponDoc?.exists() ? couponDoc.data().code : (payload.couponCode || null);

    if (targetCouponDocId && couponDoc && couponDoc.exists() && payload.memberId && redemptionRef) {
      transaction.set(redemptionRef, {
        memberId: payload.memberId,
        couponId: couponDoc.id,
        couponCode: resolvedPosCouponCode,
        transactionReferenceId: txnRef.id,
        redeemedAt: serverTimestamp(),
        sourceModule: payload.sourceModule,
        cashierId: payload.cashierId
      });
    }

    const orderType = payload.sourceModule.includes('cafe') ? 'cafeteria' : 'retail';
    const resolvedTaxAmount = Number(payload.taxAmount || 0);
    const resolvedMemberName =
      payload.memberName ||
      (memberDoc?.exists() ? `${memberDoc.data().firstName || ''} ${memberDoc.data().lastName || ''}`.trim() : null);
    const resolvedMemberPhone =
      payload.memberPhone ||
      (memberDoc?.exists() ? memberDoc.data().phone || null : null);

    const orderData = stripUndefined({
      items: stripUndefined(payload.items),
      subtotal: payload.subtotal,
      discount: payload.discount,
      manualDiscount: payload.manualDiscount ?? payload.discount,
      couponDiscount: payload.couponDiscount ?? 0,
      taxAmount: resolvedTaxAmount,
      applyVat: Boolean(payload.applyVat && resolvedTaxAmount > 0),
      vatAccount: resolvedTaxAmount > 0 ? '4427 - TVA Collectée' : null,
      total: payload.total,
      paymentMethod: payload.paymentMethod,
      paymentStatus: payload.paymentMethod === 'on_account' ? 'unpaid' : 'paid',
      amountPaid: payload.paymentMethod === 'on_account' ? 0 : payload.total,
      splitBreakdown: payload.splitBreakdown || null,
      shiftId: payload.shiftId || null,
      cashierName: payload.cashierName || null,
      memberId: payload.memberId || null,
      memberName: resolvedMemberName,
      memberPhone: resolvedMemberPhone,
      tenderedUSD: Number(payload.tenderedUSD ?? 0),
      tenderedLBP: Number(payload.tenderedLBP ?? 0),
      changeUSD: Number(payload.changeUSD ?? 0),
      changeLBP: Number(payload.changeLBP ?? 0),
      exchangeRateUsed: fxRateAtTimeOfTransaction,
      fxRate: fxRateAtTimeOfTransaction,
      type: orderType,
      date: new Date().toISOString(),
      uid: payload.cashierId,
      status: 'completed'
    });
    transaction.set(orderRef, orderData);

    const destinationAccount = orderType === 'cafeteria'
      ? '701 - Kiosk POS Sales'
      : '702 - Retail Shop POS Sales';

    if (payload.paymentMethod === 'split' && payload.splitBreakdown) {
      const legs = [
        { method: 'member_balance', label: 'Wallet', amount: Number(payload.splitBreakdown.wallet || 0) },
        { method: 'cash', label: 'Cash', amount: Number(payload.splitBreakdown.cash || 0) },
        { method: 'card', label: 'Card', amount: Number(payload.splitBreakdown.card || 0) }
      ].filter(leg => leg.amount > 0.001);

      legs.forEach((leg, idx) => {
        const legTxnRef = idx === 0 ? txnRef : doc(collection(db, 'transactions'));
        const legAdvRef = doc(db, 'advanced_transactions', legTxnRef.id);
        const legSourceAccount = resolveDefaultInflowDebitAccount(leg.method);
        const legData = {
          amount: Number(leg.amount.toFixed(2)),
          subtotal: idx === 0 ? payload.subtotal : Number(leg.amount.toFixed(2)),
          discount: idx === 0 ? payload.discount : 0,
          manualDiscount: idx === 0 ? (payload.manualDiscount ?? payload.discount) : 0,
          couponDiscount: idx === 0 ? (payload.couponDiscount ?? 0) : 0,
          taxAmount: idx === 0 ? resolvedTaxAmount : 0,
          vatAccount: idx === 0 && resolvedTaxAmount > 0 ? '4427 - TVA Collectée' : null,
          total: Number(leg.amount.toFixed(2)),
          paymentMethod: leg.method,
          memberId: payload.memberId || null,
          sourceModule: payload.sourceModule,
          cashierId: payload.cashierId,
          createdAt: serverTimestamp(),
          direction: 'inflow',
          transactionType: 'sale',
          sourceAccount: legSourceAccount,
          destinationAccount: destinationAccount,
          referenceId: orderRef.id,
          relatedIds: [payload.memberId, payload.couponId, resolvedPosCouponCode, payload.cashbackCodeId].filter(Boolean),
          notes: `Split Payment (${leg.label}: $${leg.amount.toFixed(2)} of $${payload.total.toFixed(2)}) ${payload.notes || ''}`.trim(),
          couponId: idx === 0 ? (couponDoc?.exists() ? couponDoc.id : (payload.couponId || null)) : null,
          couponCode: idx === 0 ? (resolvedPosCouponCode || cashbackCodeString || null) : null,
          cashbackCodeId: idx === 0 ? (payload.cashbackCodeId || null) : null,
          fxRateAtTimeOfTransaction,
          accountingStatus: 'posted'
        };
        transaction.set(legTxnRef, legData);
        transaction.set(legAdvRef, { ...legData, accountingStatus: advInitialStatus });
      });
    } else {
      const sourceAccount = resolveDefaultInflowDebitAccount(payload.paymentMethod);
      const txnData = {
        amount: payload.total,
        subtotal: payload.subtotal,
        discount: payload.discount,
        manualDiscount: payload.manualDiscount ?? payload.discount,
        couponDiscount: payload.couponDiscount ?? 0,
        taxAmount: resolvedTaxAmount,
        vatAccount: resolvedTaxAmount > 0 ? '4427 - TVA Collectée' : null,
        total: payload.total,
        paymentMethod: payload.paymentMethod,
        paymentStatus: payload.paymentMethod === 'on_account' ? 'unpaid' : 'paid',
        memberId: payload.memberId || null,
        sourceModule: payload.sourceModule,
        cashierId: payload.cashierId,
        createdAt: serverTimestamp(),
        direction: 'inflow',
        transactionType: 'sale',
        sourceAccount: sourceAccount,
        destinationAccount: destinationAccount,
        referenceId: orderRef.id,
        relatedIds: [payload.memberId, payload.couponId, resolvedPosCouponCode, payload.cashbackCodeId].filter(Boolean),
        notes: payload.paymentMethod === 'on_account'
          ? `On-Account Charge (411 Member SOA Receivable) — ${payload.notes || `Order #${orderRef.id.slice(0, 8)}`}`
          : (payload.notes || null),
        couponId: couponDoc?.exists() ? couponDoc.id : (payload.couponId || null),
        couponCode: resolvedPosCouponCode || cashbackCodeString || null,
        cashbackCodeId: payload.cashbackCodeId || null,
        fxRateAtTimeOfTransaction,
        accountingStatus: 'posted'
      };
      transaction.set(txnRef, txnData);
      transaction.set(advancedTxnRef, { ...txnData, accountingStatus: advInitialStatus });
    }

    if (resolvedTaxAmount > 0) {
      const vatTxnRef = doc(collection(db, 'transactions'));
      const advancedVatRef = doc(db, 'advanced_transactions', vatTxnRef.id);
      const vatData = {
        amount: resolvedTaxAmount,
        subtotal: resolvedTaxAmount,
        discount: 0,
        total: resolvedTaxAmount,
        paymentMethod: 'system',
        memberId: payload.memberId || null,
        sourceModule: payload.sourceModule,
        cashierId: payload.cashierId,
        createdAt: serverTimestamp(),
        direction: 'audit',
        transactionType: 'vat_collected',
        sourceAccount: destinationAccount,
        destinationAccount: '4427 - TVA Collectée',
        referenceId: txnRef.id,
        relatedIds: [orderRef.id, payload.memberId].filter(Boolean),
        notes: `11% Lebanese Output VAT (4427 - TVA Collectée) on Order ${orderRef.id}`,
        fxRateAtTimeOfTransaction,
        accountingStatus: 'posted'
      };
      transaction.set(vatTxnRef, vatData);
      transaction.set(advancedVatRef, { ...vatData, accountingStatus: advInitialStatus });
    }

    if (totalCOGS > 0) {
      const cogsTxnRef = doc(collection(db, 'transactions'));
      const advancedCogsRef = doc(db, 'advanced_transactions', cogsTxnRef.id);
      const inventoryAssetAccount = orderType === 'cafeteria'
        ? '301 - Kiosk POS Inventory'
        : '302 - Retail Shop Inventory';
      
      const cogsData = {
        amount: totalCOGS,
        subtotal: totalCOGS,
        discount: 0,
        total: totalCOGS,
        paymentMethod: 'system',
        memberId: payload.memberId || null,
        sourceModule: payload.sourceModule,
        cashierId: payload.cashierId,
        createdAt: serverTimestamp(),
        direction: 'audit',
        transactionType: 'inventory_cogs_movement',
        sourceAccount: '601 - Cost of Goods Sold (COGS)',
        destinationAccount: inventoryAssetAccount,
        referenceId: txnRef.id,
        relatedIds: [orderRef.id, payload.memberId].filter(Boolean),
        notes: `Auto COGS deduction for order ${orderRef.id}`,
        fxRateAtTimeOfTransaction,
        accountingStatus: 'posted'
      };
      transaction.set(cogsTxnRef, cogsData);
      transaction.set(advancedCogsRef, { ...cogsData, accountingStatus: advInitialStatus });
    }

    if (rewardAmount > 0 && payload.memberId) {
      const cashbackTxnRef = doc(collection(db, 'transactions'));
      const advancedCashbackTxnRef = doc(db, 'advanced_transactions', cashbackTxnRef.id);
      
      const cashbackData = {
        amount: rewardAmount,
        subtotal: rewardAmount,
        discount: 0,
        total: rewardAmount,
        paymentMethod: 'system',
        memberId: payload.memberId,
        sourceModule: 'cashback_credit',
        cashierId: payload.cashierId,
        createdAt: serverTimestamp(),
        direction: 'outflow',
        transactionType: 'cashback_credit',
        sourceAccount: '709 - Promotional Rewards & Cashback Contra',
        destinationAccount: '419 - Member Wallet & Deposits Liability',
        referenceId: txnRef.id,
        relatedIds: [payload.memberId, payload.cashbackCodeId].filter(Boolean),
        notes: `Cashback reward from code ${cashbackCodeString}`,
        couponCode: cashbackCodeString,
        cashbackCodeId: payload.cashbackCodeId,
        fxRateAtTimeOfTransaction,
        accountingStatus: 'posted'
      };
      transaction.set(cashbackTxnRef, cashbackData);
      transaction.set(advancedCashbackTxnRef, { ...cashbackData, accountingStatus: advInitialStatus });
    }

    return {
      success: true,
      orderId: orderRef.id,
      transactionId: txnRef.id,
      totalProcessed: payload.total,
      order: { id: orderRef.id, ...orderData }
    };
  });
};

/**
 * Creates a compensating reversal transaction to offset a previously recorded transaction.
 * Never deletes the original transaction.
 * Strictly executes ALL reads before ANY writes, and reverses associated cashback rewards, COGS, and coupon usage counts.
 */
export const processReversalTransaction = async (
  payload: ReversalTransactionPayload,
  customAction?: CustomTransactionAction,
  customPreAction?: (transaction: any) => Promise<any>
) => {
  const txnIdsToReverse = payload.originalTransactionIds || (payload.originalTransactionId ? [payload.originalTransactionId] : []);

  // Pre-discover any linked cashback_credit and inventory_cogs_movement transactions outside runTransaction
  const linkedCashbackTxnIds: string[] = [];
  const linkedCogsTxnIds: string[] = [];
  for (const txnId of txnIdsToReverse) {
    try {
      const cbQuery = query(
        collection(db, 'transactions'),
        where('referenceId', '==', txnId),
        where('transactionType', '==', 'cashback_credit')
      );
      const cbSnap = await getDocs(cbQuery);
      for (const cbDoc of cbSnap.docs) {
        if (!cbDoc.data().isReversal) {
          linkedCashbackTxnIds.push(cbDoc.id);
        }
      }
      const cogsQuery = query(
        collection(db, 'transactions'),
        where('referenceId', '==', txnId),
        where('transactionType', '==', 'inventory_cogs_movement')
      );
      const cogsSnap = await getDocs(cogsQuery);
      for (const cogsDoc of cogsSnap.docs) {
        if (!cogsDoc.data().isReversal) {
          linkedCogsTxnIds.push(cogsDoc.id);
        }
      }
    } catch (err) {
      console.warn('Could not pre-query linked transactions for reversal:', err);
    }
  }

  return await runTransaction(db, async (rawTransaction) => {
    const transaction = createSafeTransactionProxy(rawTransaction);
    // =========================================================================
    // 1. READ PHASE (Every single transaction.get MUST execute before any write)
    // =========================================================================
    let preResult: any = null;
    if (customPreAction) {
      preResult = await customPreAction(transaction);
    }

    const settingsRef = doc(db, 'system', 'settings');
    const globalSettingsRef = doc(db, 'settings', 'global');
    const [settingsDoc, globalSettingsDoc] = await Promise.all([
      transaction.get(settingsRef),
      transaction.get(globalSettingsRef)
    ]);
    const fxRateAtTimeOfTransaction = settingsDoc.exists()
      ? (settingsDoc.data().usdToLbpRate || 90000)
      : (globalSettingsDoc.exists() ? (globalSettingsDoc.data().exchangeRateLBP || 90000) : 90000);
    const accountingMode = globalSettingsDoc.exists()
      ? (globalSettingsDoc.data().accountingMode || 'posting')
      : (settingsDoc.exists() ? (settingsDoc.data().accountingMode || 'posting') : 'posting');
    const advInitialStatus = accountingMode === 'real_time' ? 'posted' : 'pending';

    // Read all original transactions
    const originalTxnDocs: { id: string; data: any }[] = [];
    const couponDocIdsToRead = new Set<string>();
    const cashbackCodeIdsToRead = new Set<string>();
    let resolvedMemberId: string | null = payload.memberId || null;

    for (const txnId of txnIdsToReverse) {
      const originalTxnRef = doc(db, 'transactions', txnId);
      const originalTxnDoc = await transaction.get(originalTxnRef);
      if (!originalTxnDoc.exists()) continue;
      const data = originalTxnDoc.data();
      originalTxnDocs.push({ id: txnId, data });
      if (!resolvedMemberId && data.memberId) {
        resolvedMemberId = data.memberId;
      }
      if (data.cashbackCodeId) {
        cashbackCodeIdsToRead.add(data.cashbackCodeId);
      }
      if (data.couponId) {
        couponDocIdsToRead.add(data.couponId);
      } else if (data.couponCode && data.couponCode !== data.cashbackCodeId) {
        couponDocIdsToRead.add(data.couponCode);
      }
    }

    // Read any linked cashback_credit transactions
    const linkedCashbackDocs: { id: string; data: any }[] = [];
    for (const cbTxnId of linkedCashbackTxnIds) {
      const cbTxnRef = doc(db, 'transactions', cbTxnId);
      const cbTxnDoc = await transaction.get(cbTxnRef);
      if (cbTxnDoc.exists() && !cbTxnDoc.data().isReversal) {
        const cbTxnData = cbTxnDoc.data();
        linkedCashbackDocs.push({ id: cbTxnId, data: cbTxnData });
        if (cbTxnData.cashbackCodeId) {
          cashbackCodeIdsToRead.add(cbTxnData.cashbackCodeId);
        }
        if (!resolvedMemberId && cbTxnData.memberId) {
          resolvedMemberId = cbTxnData.memberId;
        }
      }
    }

    // Read any linked COGS transactions
    const linkedCogsDocs: { id: string; data: any }[] = [];
    for (const cogsTxnId of linkedCogsTxnIds) {
      const cogsTxnRef = doc(db, 'transactions', cogsTxnId);
      const cogsTxnDoc = await transaction.get(cogsTxnRef);
      if (cogsTxnDoc.exists() && !cogsTxnDoc.data().isReversal) {
        linkedCogsDocs.push({ id: cogsTxnId, data: cogsTxnDoc.data() });
      }
    }

    // Read referenced cashbackCodes docs
    const cashbackCodeSnapshots = new Map<string, { ref: any; data: any }>();
    for (const cbCodeId of cashbackCodeIdsToRead) {
      const cbRef = doc(db, 'cashbackCodes', cbCodeId);
      const cbSnap = await transaction.get(cbRef);
      if (cbSnap.exists()) {
        cashbackCodeSnapshots.set(cbCodeId, { ref: cbRef, data: cbSnap.data() });
      }
    }

    // Read referenced coupons docs
    const couponSnapshots = new Map<string, { ref: any; data: any }>();
    for (const couponId of couponDocIdsToRead) {
      const cRef = doc(db, 'coupons', couponId);
      const cSnap = await transaction.get(cRef);
      if (cSnap.exists()) {
        couponSnapshots.set(couponId, { ref: cRef, data: cSnap.data() });
      }
    }

    // Read Member doc if present
    let memberRef: any = null;
    let memberDoc: any = null;
    if (resolvedMemberId) {
      memberRef = doc(db, 'members', resolvedMemberId);
      memberDoc = await transaction.get(memberRef);
    }

    // Read Inventory docs if restoreInventoryItems is provided (deduplicated across variants & bundle components)
    const invDocsMap = new Map<string, { ref: any; data: any }>();
    if (payload.restoreInventoryItems && payload.restoreInventoryItems.length > 0) {
      const initialIds = new Set<string>();
      for (const item of payload.restoreInventoryItems) {
        if (item.itemId) initialIds.add(item.itemId);
        if (Array.isArray(item.bundleComponents)) {
          for (const bc of item.bundleComponents) {
            if (bc.itemId) initialIds.add(bc.itemId);
          }
        }
      }

      for (const invId of initialIds) {
        const invRef = doc(db, 'inventory', invId);
        const invDoc = await transaction.get(invRef);
        if (invDoc.exists()) {
          invDocsMap.set(invId, { ref: invRef, data: invDoc.data() });
        }
      }

      // If any refunded item is a bundle in Firestore whose components weren't passed on the payload, read those component docs now
      const extraComponentIds = new Set<string>();
      for (const item of payload.restoreInventoryItems) {
        const parentEntry = invDocsMap.get(item.itemId);
        const comps = item.bundleComponents || parentEntry?.data?.bundleComponents || [];
        if ((item.isBundle || parentEntry?.data?.isBundle) && Array.isArray(comps)) {
          for (const bc of comps) {
            if (bc.itemId && !invDocsMap.has(bc.itemId)) {
              extraComponentIds.add(bc.itemId);
            }
          }
        }
      }

      for (const compId of extraComponentIds) {
        const compRef = doc(db, 'inventory', compId);
        const compDoc = await transaction.get(compRef);
        if (compDoc.exists()) {
          invDocsMap.set(compId, { ref: compRef, data: compDoc.data() });
        }
      }
    }

    // Aggregate all stock restorations per inventory doc ID (preventing multi-variant overwrite & restoring bundle components)
    const aggregatedRestorations = new Map<
      string,
      { totalAddQty: number; variantAdds: Map<string, number>; isBundleParentOnly?: boolean }
    >();

    const recordStockAddition = (targetId: string, qty: number, variantKey?: string, isBundleParentOnly = false) => {
      if (!targetId || qty <= 0) return;
      const existing = aggregatedRestorations.get(targetId) || {
        totalAddQty: 0,
        variantAdds: new Map<string, number>(),
        isBundleParentOnly
      };
      existing.totalAddQty += qty;
      if (variantKey) {
        existing.variantAdds.set(variantKey, (existing.variantAdds.get(variantKey) || 0) + qty);
      }
      aggregatedRestorations.set(targetId, existing);
    };

    if (payload.restoreInventoryItems && payload.restoreInventoryItems.length > 0) {
      for (const item of payload.restoreInventoryItems) {
        const parentSnap = invDocsMap.get(item.itemId);
        const isBundle = Boolean(item.isBundle || parentSnap?.data?.isBundle);
        const bundleComps: { itemId: string; quantity: number }[] =
          item.bundleComponents || parentSnap?.data?.bundleComponents || [];

        if (isBundle && Array.isArray(bundleComps) && bundleComps.length > 0) {
          for (const comp of bundleComps) {
            const compQtyToRestore = (Number(comp.quantity) || 1) * (Number(item.quantity) || 1);
            recordStockAddition(comp.itemId, compQtyToRestore);
          }
          // If the bundle parent itself tracks positive stock, restore it as well
          if (parentSnap && Number(parentSnap.data?.stock || 0) > 0) {
            recordStockAddition(item.itemId, Number(item.quantity) || 1, undefined, true);
          }
        } else {
          const vKey = item.variantId || item.variantName || undefined;
          const unitsDeductedPerQty = Math.max(
            1,
            Number(item.unitsDeductedPerQty) ||
              (item.saleUnitType === 'pack' ? Number(parentSnap?.data?.unitsPerPack || 1) : 1)
          );
          const totalUnitsToRestore = (Number(item.quantity) || 1) * unitsDeductedPerQty;
          recordStockAddition(item.itemId, totalUnitsToRestore, vKey);
        }
      }
    }

    // =========================================================================
    // 2. WRITE PHASE (All reads completed — execute atomic writes)
    // =========================================================================
    let netMemberBalanceDelta = 0;
    const createdTransactionIds: string[] = [];
    const fallbackDestinationAccount = payload.destinationAccount || '531 - Cash Drawer / Register (Caisse)';

    for (const { id: txnId, data: originalData } of originalTxnDocs) {
      const exactAmountToReverse = originalData.amount || payload.amount || 0;
      const isOriginalOutflow = originalData.direction === 'outflow';
      const resolvedSourceAccount = payload.sourceAccount || (
        isOriginalOutflow
          ? (originalData.destinationAccount || '531 - Cash Drawer / Register (Caisse)')
          : (originalData.destinationAccount || resolveDefaultRevenueCreditAccount(payload.sourceModule))
      );
      const resolvedDestinationAccount = payload.destinationAccount || originalData.sourceAccount || fallbackDestinationAccount;

      if ((resolvedDestinationAccount === 'member_balance' || resolvedDestinationAccount.startsWith('419')) && resolvedMemberId) {
        netMemberBalanceDelta += exactAmountToReverse;
      }

      const txnRef = doc(collection(db, 'transactions'));
      const advancedTxnRef = doc(db, 'advanced_transactions', txnRef.id);
      
      const reversalData = {
        amount: exactAmountToReverse,
        subtotal: exactAmountToReverse,
        discount: 0,
        total: exactAmountToReverse,
        paymentMethod: resolvedDestinationAccount.startsWith('external') 
          ? resolvedDestinationAccount.split('_')[1] 
          : ((resolvedDestinationAccount === 'member_balance' || resolvedDestinationAccount.startsWith('419')) ? 'wallet' : 'cash'),
        memberId: resolvedMemberId,
        sourceModule: payload.sourceModule,
        cashierId: payload.cashierId,
        createdAt: serverTimestamp(),
        direction: isOriginalOutflow ? 'inflow' : 'outflow',
        transactionType: payload.transactionType,
        sourceAccount: resolvedSourceAccount,
        destinationAccount: resolvedDestinationAccount,
        referenceId: txnId,
        originalReferenceId: originalData.referenceId || null,
        relatedIds: [...(payload.relatedIds || []), resolvedMemberId, txnId].filter(Boolean),
        notes: payload.reason,
        isReversal: true,
        fxRateAtTimeOfTransaction,
        accountingStatus: 'posted'
      };
      
      transaction.set(txnRef, reversalData);
      transaction.set(advancedTxnRef, { ...reversalData, accountingStatus: advInitialStatus });
      createdTransactionIds.push(txnRef.id);
    }

    // Reverse any linked COGS entries when inventory is restored
    for (const { id: cogsTxnId, data: cogsData } of linkedCogsDocs) {
      const cogsAmt = Number(cogsData.amount) || 0;
      if (cogsAmt > 0) {
        const cogsRevRef = doc(collection(db, 'transactions'));
        const advCogsRevRef = doc(db, 'advanced_transactions', cogsRevRef.id);
        const cogsRevData = {
          amount: cogsAmt,
          subtotal: cogsAmt,
          discount: 0,
          total: cogsAmt,
          paymentMethod: 'system',
          memberId: resolvedMemberId,
          sourceModule: payload.sourceModule,
          cashierId: payload.cashierId,
          createdAt: serverTimestamp(),
          direction: 'audit',
          transactionType: 'inventory_cogs_reversal',
          sourceAccount: cogsData.destinationAccount || '301 - Kiosk POS Inventory',
          destinationAccount: cogsData.sourceAccount || '601 - Cost of Goods Sold (COGS)',
          referenceId: cogsTxnId,
          notes: `COGS reversal for refunded order (${payload.reason})`,
          isReversal: true,
          fxRateAtTimeOfTransaction,
          accountingStatus: 'posted'
        };
        transaction.set(cogsRevRef, cogsRevData);
        transaction.set(advCogsRevRef, { ...cogsRevData, accountingStatus: advInitialStatus });
        createdTransactionIds.push(cogsRevRef.id);
      }
    }

    // Reverse any linked cashback_credit transactions (deduct reward from member wallet)
    for (const { id: cbTxnId, data: cbData } of linkedCashbackDocs) {
      const rewardToClawback = cbData.amount || 0;
      if (rewardToClawback > 0) {
        netMemberBalanceDelta -= rewardToClawback;
        const cbRevRef = doc(collection(db, 'transactions'));
        const advCbRevRef = doc(db, 'advanced_transactions', cbRevRef.id);
        const cbReversalData = {
          amount: rewardToClawback,
          subtotal: rewardToClawback,
          discount: 0,
          total: rewardToClawback,
          paymentMethod: 'system',
          memberId: resolvedMemberId,
          sourceModule: 'cashback_credit',
          cashierId: payload.cashierId,
          createdAt: serverTimestamp(),
          direction: 'inflow',
          transactionType: 'cashback_reversal',
          sourceAccount: '419 - Member Wallet & Deposits Liability',
          destinationAccount: '709 - Promotional Rewards & Cashback Contra',
          referenceId: cbTxnId,
          notes: `Cashback clawback for reversed transaction (${payload.reason})`,
          isReversal: true,
          fxRateAtTimeOfTransaction,
          accountingStatus: 'posted'
        };
        transaction.set(cbRevRef, cbReversalData);
        transaction.set(advCbRevRef, { ...cbReversalData, accountingStatus: advInitialStatus });
        createdTransactionIds.push(cbRevRef.id);
      }
    }

    // Decrement usageCount on any associated cashbackCodes
    cashbackCodeSnapshots.forEach(({ ref, data }) => {
      const currentCount = data.usageCount || 0;
      if (currentCount > 0) {
        transaction.update(ref, { usageCount: Math.max(0, currentCount - 1) });
      }
    });

    // Decrement usageCount on any associated coupons AND delete member redemption lock doc
    couponSnapshots.forEach(({ ref, data }, couponDocId) => {
      const currentCount = data.usageCount || 0;
      if (currentCount > 0) {
        transaction.update(ref, { usageCount: Math.max(0, currentCount - 1) });
      }
      if (resolvedMemberId) {
        const redemptionLockRef = doc(db, `coupons/${couponDocId}/redemptions`, resolvedMemberId);
        transaction.delete(redemptionLockRef);
      }
    });

    // Update member wallet balance (wallet refund + cashback clawback)
    if (netMemberBalanceDelta !== 0 && memberRef && memberDoc && memberDoc.exists()) {
      const currentBalance = memberDoc.data().balance || 0;
      transaction.update(memberRef, { balance: currentBalance + netMemberBalanceDelta });
    }

    // Restore inventory stock (variants, bundle components, and parent stock) in a single atomic update per item
    aggregatedRestorations.forEach((restoreInfo, invId) => {
      const snap = invDocsMap.get(invId);
      if (!snap) return;
      const currentStock = Number(snap.data.stock || 0);
      const currentVariants = Array.isArray(snap.data.variants)
        ? snap.data.variants.map((v: any) => ({ ...v }))
        : undefined;

      if (currentVariants && currentVariants.length > 0 && restoreInfo.variantAdds.size > 0) {
        restoreInfo.variantAdds.forEach((addVarQty, varKey) => {
          const vIdx = currentVariants.findIndex(
            (v: any) => v.id === varKey || v.name === varKey
          );
          if (vIdx !== -1) {
            currentVariants[vIdx].stock = Number(currentVariants[vIdx].stock || 0) + addVarQty;
          }
        });
        const recomputedParentStock = currentVariants.reduce(
          (sum: number, v: any) => sum + Number(v.stock || 0),
          0
        );
        transaction.update(snap.ref, {
          stock: Math.max(currentStock + restoreInfo.totalAddQty, recomputedParentStock),
          variants: currentVariants,
          updatedAt: new Date().toISOString()
        });
      } else {
        transaction.update(snap.ref, {
          stock: currentStock + restoreInfo.totalAddQty,
          updatedAt: new Date().toISOString()
        });
      }
    });

    // Execute consumer's custom write action (passing pre-read originalTxnDocs and preResult)
    if (customAction) {
      await customAction(transaction, preResult ?? originalTxnDocs);
    }

    return {
      success: true,
      transactionIds: createdTransactionIds
    };
  });
};

