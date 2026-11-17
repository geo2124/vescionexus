import { collection, addDoc, updateDoc, doc, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { FirestoreErrorInfo, OperationType } from '../types';
import { User } from 'firebase/auth';
import { toast } from 'sonner';

export interface SystemAuditLog {
  id?: string;
  action:
    | 'CREATE'
    | 'UPDATE'
    | 'DELETE'
    | 'SOFT_DELETE'
    | 'RESTORE'
    | 'REVERSAL'
    | 'VOID_POSTED_ENTRY'
    | 'REJECT_QUEUE_ENTRY'
    | 'UNPOST_ENTRY'
    | 'PERIOD_CLOSE'
    | 'PERIOD_REOPEN'
    | 'YEAR_END_CARRY_FORWARD'
    | 'MANUAL_JOURNAL'
    | 'DISCOUNT_100'
    | 'STOCK_ADJUST'
    | string;
  collectionName: string;
  documentId: string;
  staffId: string;
  timestamp: string;
  details?: Record<string, any>;
}

export const logSystemAudit = async (auditData: SystemAuditLog) => {
  try {
    const auditRef = collection(db, 'system_audit');
    await addDoc(auditRef, {
      ...auditData,
      timestamp: auditData.timestamp || new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to log system audit:', error);
  }
};

export const normalizePhone = (phone?: string | null): string => {
  if (!phone) return '';
  return phone.replace(/[\s\-().+]/g, '').trim();
};

export const findOrCreateMemberByPhoneOrName = async (params: {
  firstName: string;
  lastName?: string;
  phone?: string;
  email?: string;
  extraFields?: Record<string, any>;
  staffId: string;
}) => {
  const membersRef = collection(db, 'members');
  const normPhone = normalizePhone(params.phone);
  const firstClean = (params.firstName || '').trim();
  const lastClean = (params.lastName || '').trim();
  const fullClean = `${firstClean} ${lastClean}`.trim().toLowerCase();

  const snapshot = await getDocs(membersRef);
  let matchedDoc: { id: string; data: any } | null = null;

  for (const d of snapshot.docs) {
    const data = d.data();
    if (
      data.isDeleted === true ||
      d.id === 'walk_in' ||
      d.id === 'system_walk_in' ||
      data.isSystemWalkIn === true ||
      data.packageId === 'walk-in'
    ) {
      continue;
    }
    const existingPhone = normalizePhone(data.phone);
    if (normPhone && existingPhone && normPhone === existingPhone) {
      matchedDoc = { id: d.id, data };
      break;
    }
    const existingFull = `${(data.firstName || '').trim()} ${(data.lastName || '').trim()}`.trim().toLowerCase();
    if (fullClean && existingFull === fullClean && (!normPhone || !existingPhone || normPhone === existingPhone)) {
      matchedDoc = { id: d.id, data };
      break;
    }
  }

  if (matchedDoc) {
    const updates: Record<string, any> = {
      ...(params.extraFields || {}),
      updatedAt: new Date().toISOString()
    };
    if (params.phone && !matchedDoc.data.phone) updates.phone = params.phone.trim();
    if (params.email && !matchedDoc.data.email) updates.email = params.email.trim();
    if (matchedDoc.data.memberType === 'ghost' && params.extraFields?.memberType === 'full') {
      updates.memberType = 'full';
      if (matchedDoc.data.status === 'unregistered') {
        updates.status = 'active';
      }
    }
    await updateDoc(doc(db, 'members', matchedDoc.id), updates);
    return {
      memberId: matchedDoc.id,
      memberData: { ...matchedDoc.data, ...updates },
      created: false
    };
  }

  const newMemberData: Record<string, any> = {
    firstName: firstClean || 'Guest',
    lastName: lastClean,
    phone: (params.phone || '').trim(),
    email: (params.email || '').trim(),
    status: params.extraFields?.status || 'active',
    balance: 0,
    isDeleted: false,
    createdAt: new Date().toISOString(),
    createdBy: params.staffId,
    uid: params.staffId,
    memberType: params.extraFields?.memberType || 'full',
    ...(params.extraFields || {})
  };

  const newDocRef = await addDoc(membersRef, newMemberData);

  await logSystemAudit({
    action: 'CREATE',
    collectionName: 'members',
    documentId: newDocRef.id,
    staffId: params.staffId,
    timestamp: new Date().toISOString(),
    details: { memberType: newMemberData.memberType, phone: newMemberData.phone }
  });

  return {
    memberId: newDocRef.id,
    memberData: newMemberData,
    created: true
  };
};

export const getOrCreateGhostMember = async (phone: string, firstName: string, staffId: string) => {
  const nameParts = (firstName || 'Guest').trim().split(' ');
  const first = nameParts[0] || 'Guest';
  const last = nameParts.slice(1).join(' ') || '';

  return await findOrCreateMemberByPhoneOrName({
    firstName: first,
    lastName: last,
    phone,
    staffId,
    extraFields: {
      status: 'unregistered',
      memberType: 'ghost'
    }
  });
};

export const softDeleteDocument = async (collectionName: string, documentId: string, staffId: string) => {
  const docRef = doc(db, collectionName, documentId);
  await updateDoc(docRef, {
    isDeleted: true,
    deletedAt: new Date().toISOString(),
    deletedBy: staffId
  });
  
  await logSystemAudit({
    action: 'SOFT_DELETE',
    collectionName,
    documentId,
    staffId,
    timestamp: new Date().toISOString()
  });
};

export const restoreSoftDeletedDocument = async (collectionName: string, documentId: string, staffId: string) => {
  const docRef = doc(db, collectionName, documentId);
  await updateDoc(docRef, {
    isDeleted: false,
    restoredAt: new Date().toISOString(),
    restoredBy: staffId
  });

  await logSystemAudit({
    action: 'RESTORE',
    collectionName,
    documentId,
    staffId,
    timestamp: new Date().toISOString()
  });
};

export const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null, user: User | null) => {
  const message = error instanceof Error ? error.message : String(error);
  toast.error(`Operation failed: ${message}`);
  const errInfo: FirestoreErrorInfo = {
    error: message,
    authInfo: {
      userId: user?.uid,
      email: user?.email,
      emailVerified: user?.emailVerified,
      isAnonymous: user?.isAnonymous,
      tenantId: user?.tenantId,
      providerInfo: user?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoURL: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
};
