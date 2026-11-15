import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: String(import.meta.env.VITE_FIREBASE_API_KEY || 'demo-firebase-api-key'),
  authDomain: String(
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'demo-project.firebaseapp.com',
  ),
  projectId: String(import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-project'),
  appId: String(import.meta.env.VITE_FIREBASE_APP_ID || '1:000000000000:web:demo'),
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
