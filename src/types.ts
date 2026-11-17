export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoURL: string | null;
    }[];
  }
}

export interface CheckIn {
  id: string;
  memberId: string;
  date: string;
  coach: string;
  coachId?: string;
  clientName?: string;
  guestClientName?: string;
  contractId?: string;
  sessionGroupId?: string;
  participantIds?: string[];
  participantNames?: string[];
  clientCount?: number;
  sessionFee?: number;
  leadSource?: 'partner_client' | 'facility_client';
  thirdPartyContractId?: string;
}

export type CheckInRecord = CheckIn;

export interface GymPackage {
  id: string;
  name: string;
  duration: number; // in months
  price: number;
  discountPercent: number;
  discountAmount?: number;
  priceOverride?: number;
  discountExpiry?: string;
  sessions: number;
  image?: string;
  type: 'solo' | 'group';
  maxPeople?: number;
  addons: { name: string; price: number }[];
}

export interface GroupParticipant {
  name: string;
  phone?: string;
}

export interface MemberSubscription {
  id: string;
  module: 'gym' | 'physio';
  packageId: string;
  packageName: string;
  totalSessions: number;
  usedSessions: number;
  remainingSessions: number;
  startDate: string;
  expiryDate: string;
  price: number;
  amountPaid: number;
  billingStatus: 'paid' | 'unpaid' | 'partial';
  assignedStaffId?: string;
  assignedStaffName?: string;
  status: 'active' | 'expired' | 'completed' | 'cancelled';
  sharedSubscriptionId?: string;
  linkedMemberIds?: string[];
  linkedMemberNames?: string[];
  createdAt?: string;
}

export interface Member {
  id: string;
  firstName: string;
  lastName: string;
  dob: string;
  gender: string;
  nationality: string;
  level: 'Novice' | 'Intermediate' | 'Expert';
  height: string;
  weight: string;
  allergies: string;
  healthProblems: string;
  phone: string;
  email: string;
  address?: string;
  maritalStatus?: 'Single' | 'Married' | 'Divorced' | 'Widowed' | string;
  occupation?: string;
  assignedPhysiotherapistId?: string;
  assignedPhysiotherapistName?: string;
  referringPhysician?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
  isInsured?: boolean;
  insuranceCompanyName?: string;
  visitType?: 'Initial Session' | 'Assessment' | 'Follow up' | 'Rehab Session' | string;
  numberOfSessions?: number;
  bloodType?: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | 'Unknown' | string;
  scanImageUrl?: string;
  scanImageName?: string;
  intakeSource?: 'reception' | 'self_link' | string;
  
  // Multi-module active subscriptions & shared family pools
  activeSubscriptions?: MemberSubscription[];
  sharedSubscriptionId?: string;
  sharedGroupMemberIds?: string[];
  primaryGroupMemberId?: string;

  // Gym specific
  isGymMember?: boolean;
  packageId?: string;
  assignedCoachId?: string;
  assignedCoachName?: string;
  groupMembers?: GroupParticipant[];
  discountPercent?: number;
  discountAmount?: number;
  priceOverride?: number;
  currentCycleCheckIns?: number;
  isFrozen?: boolean;
  freezeStartDate?: string | null;
  totalFrozenDays?: number;
  startDate?: string;
  expiryDate?: string;
  status?: 'active' | 'inactive' | 'expire soon' | 'expired' | 'frozen';
  billingStatus?: 'paid' | 'unpaid';
  addons?: string[];
  totalPaid?: number;
  expectedFee?: number;
  qrCode?: string;
  checkIns?: CheckIn[];
  membershipHistory?: { id: string, startDate: string, expiryDate: string, packageId: string, totalPaid: number, checkIns: CheckIn[] }[];
  paymentHistory?: { id: string, date: string, amount: number, packageId: string }[];
  
  // Physio specific
  isPhysioPatient?: boolean;
  medicalHistory?: string;
  notes?: string;
  physioDiagnosis?: string;
  physioBodyArea?: string;
  physioCaseStatus?: string;
  physioEstimatedSessions?: number;
  physioCompletedSessions?: number;
  physioAssignedTherapistId?: string;
  physioAssignedRoomId?: string;
  physioPainScale?: number;
  physioSoapNotes?: string;
  physioActivePackages?: PhysioPatientPackageSubscription[];
  
  // Wallet/POS specific
  balance?: number;
  walletBalance?: number;
  memberType?: 'full' | 'ghost';
  isSystemWalkIn?: boolean;
  
  uid?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PhysioRoom {
  id: string;
  name: string;
  equipmentTags: string[];
  isActive: boolean;
  uid?: string;
}

export interface PhysioSessionTypeOption {
  id: string;
  name: string;
  defaultDurationMinutes: number;
  defaultPrice: number;
}

export interface PhysioClinicalSettings {
  id: string;
  sessionTypes: PhysioSessionTypeOption[];
  injuryCategories: string[];
  customStatuses: string[];
  updatedAt?: string;
}

export interface PhysioPackage {
  id: string;
  name: string;
  targetType: 'patient' | 'therapist';
  sessionType: string;
  sessions: number;
  price: number;
  discountPercent?: number;
  discountAmount?: number;
  priceOverride?: number;
  durationWeeks?: number;
  notes?: string;
  uid?: string;
  createdAt?: string;
}

export interface PhysioPatientPackageSubscription {
  id: string;
  packageId: string;
  packageName: string;
  sessionType: string;
  totalSessions: number;
  usedSessions: number;
  pricePaid: number;
  startDate: string;
  expiryDate?: string;
  status: 'active' | 'completed' | 'expired';
}

export interface ThirdPartyPractitioner {
  id: string;
  name: string;
  specialty?: string;
  roleOrSpecialty?: string;
  phone?: string;
  email?: string;
  linkedStaffId?: string;
  completedSessions?: number;
}

export interface PhysioThirdPartyContract {
  id: string;
  partnerName: string;
  contactPerson: string;
  phone: string;
  email?: string;
  contactEmail?: string;
  modelType: 'revenue_split' | 'fixed_rent';
  partnerClientSplitFacilityPct?: number;
  partnerClientSplitPartnerPct?: number;
  facilityClientSplitFacilityPct?: number;
  facilityClientSplitPartnerPct?: number;
  defaultSessionPrice?: number;
  fixedMonthlyRent?: number;
  allowedSessionsQuota?: number;
  usedSessionsCurrentCycle?: number;
  overageFeePerSession?: number;
  enableFacilityClientSplitOnFixedRent?: boolean;
  facilityClientSplitPercent?: number;
  billingCycleStart?: string;
  billingCycleEnd?: string;
  linkedTherapistIds: string[];
  practitioners?: ThirdPartyPractitioner[];
  addonExpenses: ThirdPartyAddonExpense[];
  settlements: ThirdPartySettlementRecord[];
  status: 'active' | 'inactive';
  uid?: string;
  createdAt: string;
}

export interface CoachPackage {
  id: string;
  name: string;
  lengthInWeeks: number;
  sessions: number;
  cost: number;
  discountPercent?: number;
  discountAmount?: number;
  priceOverride?: number;
}

export interface CoachSessionLedgerEntry {
  id: string;
  date: string;
  clientNames: string[];
  memberIds?: string[];
  clientCount: number;
  calculatedFee: number;
  feeOverride?: number;
  leadSource?: 'partner_client' | 'facility_client';
  thirdPartyContractId?: string;
  status?: 'completed' | 'settled';
  notes?: string;
}

export interface CoachContract {
  id: string;
  coachId: string;
  type: 'inhouse' | 'freelance' | 'third_party';
  contractMode?: 'package' | 'session_bypass' | 'third_party';
  packageId?: string;
  price: number;
  discountPercent: number;
  discountAmount?: number;
  priceOverride?: number;
  sessions: number;
  remainingSessions?: number;
  baseFeeOneClient?: number;
  extraClientFee?: number;
  maxClientsPerSession?: number;
  tierFees?: { [clientCount: number]: number };
  thirdPartyContractId?: string;
  thirdPartyName?: string;
  accruedSessionFees?: number;
  startDate: string;
  endDate: string;
  billingStatus?: 'paid' | 'unpaid';
  paymentHistory?: { id: string, date: string, amount: number, notes?: string, direction?: 'inflow' | 'outflow' }[];
}

export interface Coach {
  id: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  email: string;
  dob: string;
  gender: string;
  yearsOfExperience: number;
  lastWorkPlace: string;
  specialties: string[];
  hourRate: number;
  type: 'inhouse' | 'freelance' | 'third_party';
  contractMode?: 'package' | 'session_bypass' | 'third_party';
  baseFeeOneClient?: number;
  extraClientFee?: number;
  maxClientsPerSession?: number;
  tierFees?: { [clientCount: number]: number };
  thirdPartyContractId?: string;
  thirdPartyName?: string;
  accruedSessionFees?: number;
  totalPaidFees?: number;
  sessionLedger?: CoachSessionLedgerEntry[];
  paymentHistory?: { id: string, date: string, amount: number, notes?: string, direction?: 'inflow' | 'outflow' }[];
  monthlySessionCapacity?: number;
  currentMonthlySessions?: number;
  lastResetDate?: string;
  qrCode?: string;
  photo?: string;
  nationality?: string;
  cvFile?: string;
  idFiles?: string[];
  crcFile?: string;
  checkIns?: {
    id: string;
    timestamp: string;
    coachId: string;
    coachName: string;
    guestClientName?: string;
    participantNames?: string[];
    participantIds?: string[];
    clientCount?: number;
    sessionFee?: number;
    leadSource?: 'partner_client' | 'facility_client';
    thirdPartyContractId?: string;
    contractId?: string;
  }[];
}

export interface GymScheduledSession {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  coachId: string;
  coachName: string;
  participantMemberIds: string[];
  participantNames: string[];
  guestNames: string[];
  clientCount: number;
  calculatedCoachFee: number;
  feeOverride?: number | null;
  finalSessionFee: number;
  sessionRevenue?: number;
  leadSource?: 'partner_client' | 'facility_client';
  thirdPartyContractId?: string;
  thirdPartyName?: string;
  status: 'scheduled' | 'checked_in' | 'cancelled' | 'no_show';
  notes?: string;
  checkedInAt?: string;
  uid?: string;
  createdAt: string;
}

export interface ThirdPartyAddonExpense {
  id: string;
  name: string;
  type: 'fixed' | 'percentage_of_bill';
  fixedAmount?: number;
  billTotalAmount?: number;
  percentage?: number;
  calculatedAmount: number;
  date: string;
  notes?: string;
}

export interface ThirdPartySettlementRecord {
  id: string;
  date: string;
  periodStart: string;
  periodEnd: string;
  sessionsCount: number;
  grossSessionRevenue: number;
  facilitySessionShare: number;
  partnerSessionShare: number;
  fixedRentCharge: number;
  overageSessionsCount: number;
  overageFeeCharge: number;
  facilityReferredSplitDue?: number;
  addonExpensesTotal: number;
  netDueToFacility: number;
  amountSettled: number;
  paymentMethod: 'cash' | 'card' | 'transfer';
  notes?: string;
}

export interface ThirdPartyGymContract {
  id: string;
  partnerName: string;
  contactPerson: string;
  phone: string;
  email?: string;
  contactEmail?: string;
  modelType: 'revenue_split' | 'fixed_rent';
  // Model A: Dual Revenue Split
  partnerClientSplitFacilityPct?: number; // e.g., 35% to Facility when Partner brings client
  partnerClientSplitPartnerPct?: number;  // e.g., 65% to Partner when Partner brings client
  facilityClientSplitFacilityPct?: number; // e.g., 60% to Facility when Facility brings client
  facilityClientSplitPartnerPct?: number;  // e.g., 40% to Partner when Facility brings client
  defaultSessionPrice?: number;
  // Model B: Fixed Rent + Allowed Sessions Quota (+ Optional Hybrid Facility-Referred Split)
  fixedMonthlyRent?: number;
  allowedSessionsQuota?: number;
  usedSessionsCurrentCycle?: number;
  overageFeePerSession?: number;
  enableFacilityClientSplitOnFixedRent?: boolean;
  facilityClientSplitPercent?: number;
  billingCycleStart?: string;
  billingCycleEnd?: string;
  // Linked Coaches, Multi-Practitioners & Add-on Expenses
  linkedCoachIds: string[];
  practitioners?: ThirdPartyPractitioner[];
  addonExpenses: ThirdPartyAddonExpense[];
  settlements: ThirdPartySettlementRecord[];
  status: 'active' | 'inactive';
  uid?: string;
  createdAt: string;
}


export type BookingCategory = 'public' | 'academy' | 'private' | 'hustle';

export interface Booking {
  id: string;
  name: string;
  phone: string;
  date: string;
  time?: string;
  startTime?: string;
  endTime?: string;
  court: string;
  type?: string;
  price?: number;
  rateApplied?: number;
  category?: BookingCategory;
  isIndividualAccess?: boolean;
  bookingSubType?: 'standard' | 'individual_access' | string;
  individualAccessScope?: 'Half Court' | 'Full Court' | string;
  hasCustomPricing?: boolean;
  groupId?: string;
  isDeleted?: boolean;
  status: 'booked' | 'cashed-in' | 'cashed_in' | 'cancelled';
  createdAt: string;
  uid: string;
  memberId?: string;
}

export interface CourtConfig {
  rates: { [key: string]: number };
  offDays: string[];
}

export interface Coupon {
  id: string;
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  usageLimit: number; // 0 for unlimited, 1 for one-time, etc.
  usageCount: number;
  expiryDate?: string;
  applicableModules?: string[];
  isActive?: boolean;
  uid: string;
  createdAt: string;
}

export interface CashbackCode {
  id: string;
  code: string;
  cashbackType: 'percentage' | 'fixed';
  value: number;
  expiryDate?: string;
  maxUses: number;
  usageCount: number;
  isActive: boolean;
  memberId?: string;
  applicableModules?: string[];
  uid: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ProductVariant {
  id: string;
  name: string; // e.g., 'Vanilla', 'Chocolate', 'Size L', 'Size XL'
  sku?: string;
  priceOverride?: number;
  stock: number;
}

export interface BundleComponent {
  itemId: string;
  name?: string;
  itemName?: string;
  quantity: number;
}

export interface POSSubcategory {
  id: string;
  name: string;      // English name
  nameAr?: string;   // Arabic name (used in Kiosk POS Arabic mode)
}

export interface POSCategoryConfig {
  id: string;
  name: string;      // English name
  nameAr?: string;   // Arabic name (used in Kiosk POS Arabic mode)
  posType: 'cafeteria' | 'retail';
  subcategories: POSSubcategory[];
}

export interface InventoryItem {
  id: string;
  name: string;
  nameAr?: string;
  sku?: string;
  barcode?: string;
  category: string;
  categoryAr?: string;
  subcategory?: string;
  subcategoryAr?: string;
  price: number;
  priceLBP?: number;
  cost: number;
  costPrice?: number;
  costPriceLBP?: number;
  isPackagedGood?: boolean;
  unitsPerPack?: number;
  packCostLBP?: number;
  packCostPrice?: number;
  unitSellingPriceLBP?: number;
  unitSellingPrice?: number;
  packSellingPriceLBP?: number;
  packSellingPrice?: number;
  stock: number;
  lowStockThreshold?: number;
  reorderQuantity?: number;
  supplier?: string;
  expiryDate?: string;
  image?: string;
  type: 'cafeteria' | 'retail';
  posType?: 'cafeteria' | 'retail';
  variants?: ProductVariant[];
  isBundle?: boolean;
  bundleComponents?: BundleComponent[];
  uid: string;
  updatedAt?: string;
}

export interface POSParkedOrder {
  id: string;
  label?: string;
  tabLabel?: string;
  posType: 'cafeteria' | 'retail';
  items: {
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
    bundleComponents?: BundleComponent[];
  }[];
  memberId?: string | null;
  memberName?: string | null;
  guestPhone?: string;
  guestName?: string;
  discount: number;
  couponCode?: string;
  cashbackCode?: string;
  createdAt: string;
  createdBy?: string;
  cashierId?: string;
}

export interface POSShift {
  id: string;
  posType: 'cafeteria' | 'retail';
  cashierId: string;
  cashierName: string;
  openedAt: string;
  closedAt?: string | null;
  status: 'open' | 'closed';
  openingFloatUSD: number;
  openingFloatLBP: number;
  expectedDrawerUSD?: number;
  expectedDrawerLBP?: number;
  actualCountedUSD?: number;
  actualCountedLBP?: number;
  varianceUSD?: number;
  varianceLBP?: number;
  closingNotes?: string;
}

export interface POSOrder {
  id: string;
  items: {
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
    bundleComponents?: BundleComponent[];
  }[];
  subtotal: number;
  discount: number;
  manualDiscount?: number;
  couponDiscount?: number;
  taxAmount?: number;
  applyVat?: boolean;
  total: number;
  paymentMethod: 'cash' | 'card' | 'member_balance' | 'on_account' | 'split';
  paymentStatus?: 'paid' | 'unpaid';
  splitBreakdown?: {
    wallet: number;
    cash: number;
    card: number;
  } | null;
  shiftId?: string | null;
  cashierName?: string;
  memberId?: string;
  memberName?: string | null;
  memberPhone?: string | null;
  tenderedUSD?: number;
  tenderedLBP?: number;
  changeUSD?: number;
  changeLBP?: number;
  exchangeRateUsed?: number;
  fxRate?: number;
  type: 'cafeteria' | 'retail';
  date: string;
  uid: string;
  status?: 'completed' | 'refunded' | 'voided';
  refundedInShiftId?: string | null;
  refundedAt?: string | null;
}

export interface HREmployee {
  id: string;
  name: string;
  role: string;
  department: string;
  email: string;
  phone: string;
  salary: number; // Base monthly salary (USD)
  baseSalary?: number;
  hourlyOvertimeRate?: number;
  nssfContribution?: number; // Employee/Employer NSSF amount
  commissionRatePerSession?: number; // Fixed $ per session
  commissionPercent?: number; // % of session revenue (for Physio/Courts)
  linkedCoachId?: string; // Optional link to Gym 'coaches' doc ID
  linkedTherapistId?: string; // Optional link to Physio 'physiotherapists' doc ID
  joinDate: string;
  status: 'active' | 'on_leave' | 'terminated';
  advances?: number; // Current outstanding salary advance to deduct
  bonuses?: number; // Current cycle bonus to add
  deductions?: number; // Current cycle penalties/deductions
  lastPayrollPaidMonth?: string; // e.g., '2026-10'
  payrollRecurrence?: 'monthly' | 'weekly' | 'biweekly';
  uid?: string;
  createdAt?: string;
}

export const COUNTRIES = [
  { name: 'Lebanon', flag: '🇱🇧', code: 'LB' },
  { name: 'United States', flag: '🇺🇸', code: 'US' },
  { name: 'United Kingdom', flag: '🇬🇧', code: 'GB' },
  { name: 'France', flag: '🇫🇷', code: 'FR' },
  { name: 'Germany', flag: '🇩🇪', code: 'DE' },
  { name: 'Italy', flag: '🇮🇹', code: 'IT' },
  { name: 'Spain', flag: '🇪🇸', code: 'ES' },
  { name: 'Canada', flag: '🇨🇦', code: 'CA' },
  { name: 'Australia', flag: '🇦🇺', code: 'AU' },
  { name: 'Brazil', flag: '🇧🇷', code: 'BR' },
  { name: 'Japan', flag: '🇯🇵', code: 'JP' },
  { name: 'China', flag: '🇨🇳', code: 'CN' },
  { name: 'India', flag: '🇮🇳', code: 'IN' },
  { name: 'Russia', flag: '🇷🇺', code: 'RU' },
  { name: 'South Africa', flag: '🇿🇦', code: 'ZA' },
  { name: 'United Arab Emirates', flag: '🇦🇪', code: 'AE' },
  { name: 'Saudi Arabia', flag: '🇸🇦', code: 'SA' },
  { name: 'Jordan', flag: '🇯🇴', code: 'JO' },
  { name: 'Egypt', flag: '🇪🇬', code: 'EG' },
  { name: 'Turkey', flag: '🇹🇷', code: 'TR' },
  { name: 'Greece', flag: '🇬🇷', code: 'GR' },
  { name: 'Cyprus', flag: '🇨🇾', code: 'CY' },
  { name: 'Syria', flag: '🇸🇾', code: 'SY' },
  { name: 'Iraq', flag: '🇮🇶', code: 'IQ' },
  { name: 'Kuwait', flag: '🇰🇼', code: 'KW' },
  { name: 'Qatar', flag: '🇶🇦', code: 'QA' },
  { name: 'Oman', flag: '🇴🇲', code: 'OM' },
];
