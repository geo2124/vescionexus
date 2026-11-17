import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import _firebaseConfig from '../firebase-applet-config.json';

const configData = _firebaseConfig?.projectId ? _firebaseConfig : ((_firebaseConfig as any).default || _firebaseConfig);

export const firebaseConfig = {
  ...configData,
  projectId: configData.projectId || "gen-lang-client-0465854708"
};

// Initialize Firebase SDK
console.log('Firebase config loaded:', firebaseConfig);
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
