import { OperationType, FirestoreErrorInfo } from '../types';
import { toast } from 'sonner';

export const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null, user: any) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: user?.uid,
      email: user?.email,
      emailVerified: user?.emailVerified,
      isAnonymous: user?.isAnonymous,
      tenantId: user?.tenantId,
      providerInfo: user?.providerData?.map((provider: any) => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  let userMessage = 'An unexpected error occurred with the database.';
  
  if (errInfo.error.includes('permission-denied')) {
    userMessage = `Access Denied: You don't have permission to ${operationType} in ${path}.`;
  } else if (errInfo.error.includes('not-found')) {
    userMessage = `Not Found: The requested ${path} could not be located.`;
  } else if (errInfo.error.includes('quota-exceeded')) {
    userMessage = 'Database quota exceeded. Please try again tomorrow.';
  }
  
  toast.error(userMessage, {
    description: 'The technical details have been logged for the administrator.',
    duration: 5000,
  });
  
  throw new Error(JSON.stringify(errInfo));
};
