/**
 * Authentication Context for CoFoundr.
 *
 * Email/password and Google both end with the same thing in secure storage: an
 * access token this app's backend signed.
 *
 * Google sign-in used to be a redirect to Emergent's hosted OAuth service, which
 * handed back an opaque session id — so it stopped working the moment the backend
 * left that platform, and nothing in our stack ever verified the identity. It now
 * runs the standard flow against Google directly with PKCE, and the ID token is
 * verified server-side before an account is touched.
 */
import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { Platform } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { storage } from '@/src/utils/storage';
import { api, setUnauthorizedHandler } from '@/src/api/client';
import { disconnectSocket } from '@/src/lib/socket';

// Closes the popup/tab the auth flow opened once it redirects back.
WebBrowser.maybeCompleteAuthSession();

/**
 * OAuth client IDs, one per platform — Google issues a token stamped with the
 * client that asked for it, and the backend only accepts ones it recognises.
 *
 * Public values, safe to ship: the PKCE flow has no client secret, which is the
 * whole reason it exists for apps that cannot keep one.
 */
const GOOGLE_CLIENT_IDS = {
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
};

/**
 * Whether Google sign-in can run *here*. Google's provider needs the client id for
 * the platform it is running on, so having any one of the three is not enough — a
 * web build holding only the iOS id would still throw.
 */
const CLIENT_ID_FOR_THIS_PLATFORM = Platform.select({
  ios: GOOGLE_CLIENT_IDS.iosClientId,
  android: GOOGLE_CLIENT_IDS.androidClientId,
  default: GOOGLE_CLIENT_IDS.webClientId,
});

export const googleSignInConfigured = Boolean(CLIENT_ID_FOR_THIS_PLATFORM);

type GooglePrompt = () => Promise<unknown>;

/**
 * Holds Google's auth hook, and nothing else.
 *
 * `useIdTokenAuthRequest` throws outright when the platform's client id is
 * missing, so it cannot live in `AuthProvider`: an unconfigured build would take
 * the entire app down with it — a blank screen, before any error boundary or the
 * `googleSignInConfigured` checks below could do anything. Isolating it here means
 * the app runs without Google and simply doesn't offer the button.
 *
 * This is not a conditionally-called hook: `googleSignInConfigured` is derived
 * from build-time environment variables and never changes, so this component
 * either mounts for the process's whole life or never mounts at all.
 */
function GoogleAuthBridge({
  promptRef,
  onIdToken,
}: {
  promptRef: React.MutableRefObject<GooglePrompt | null>;
  onIdToken: (idToken: string) => void;
}) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest(GOOGLE_CLIENT_IDS);

  // `request` is null until the PKCE challenge has been generated, and prompting
  // before then silently does nothing — so the prompt is only published once it is
  // genuinely usable, and `signInWithGoogle` can tell the difference.
  promptRef.current = request ? promptAsync : null;

  useEffect(() => {
    if (response?.type !== 'success') return;

    // `id_token` is the identity assertion the backend verifies. The access token
    // Google also returns is for calling Google's own APIs, which we do not do.
    const idToken = response.params?.id_token;
    if (!idToken) {
      console.error('Google sign-in returned no id_token');
      return;
    }
    onIdToken(idToken);
  }, [response, onIdToken]);

  return null;
}

export interface UserVerification {
  email_verified: boolean;
  linkedin_verified: boolean;
  github_verified: boolean;
  portfolio_verified: boolean;
  identity_verified: boolean;
}

export interface UserGamification {
  level: number;
  projects_count: number;
  startups_created: number;
  recommendations_count: number;
  badges: string[];
}

export interface UserSettings {
  notifications_enabled: boolean;
  distance_preference: number;
  show_age: boolean;
}

export interface User {
  user_id: string;
  email: string;
  profile: any;
  onboarding_completed: boolean;
  /** Premium lives at the document root — screens read `user.premium`. */
  premium?: boolean;
  premium_plan?: string | null;
  premium_since?: string | null;
  verification?: Partial<UserVerification>;
  gamification?: Partial<UserGamification>;
  settings?: Partial<UserSettings>;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Published by GoogleAuthBridge when — and only when — Google is configured.
  const googlePromptRef = useRef<GooglePrompt | null>(null);

  useEffect(() => {
    // Setup 401 handler to force logout + redirect
    setUnauthorizedHandler(() => {
      disconnectSocket();
      setUser(null);
    });

    // Check for existing session on mount
    checkExistingSession();
  }, []);

  // Google's response arrives asynchronously after the browser closes, so the
  // session is established here rather than awaited inline at the call site.
  const handleGoogleIdToken = useCallback(async (idToken: string) => {
    try {
      const session = await api.googleCallback(idToken);
      await storage.secureSet('auth_token', session.access_token);
      setUser(await api.getMe());
    } catch (error) {
      console.error('Google sign in failed:', error);
    }
  }, []);

  const checkExistingSession = async () => {
    try {
      const token = await storage.secureGet('auth_token', null);
      if (token) {
        const userData = await api.getMe();
        setUser(userData);
      }
    } catch {
      // A stored token that no longer resolves to a user is worse than none: every
      // later request retries with it and gets a 401.
      console.log('No existing session');
      await storage.secureRemove('auth_token');
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, name: string) => {
    const response = await api.register(email, password, name);
    await storage.secureSet('auth_token', response.access_token);
    const userData = await api.getMe();
    setUser(userData);
  };

  const signIn = async (email: string, password: string) => {
    const response = await api.login(email, password);
    await storage.secureSet('auth_token', response.access_token);
    const userData = await api.getMe();
    setUser(userData);
  };

  /**
   * Open Google's consent screen. The session is established by the effect above
   * when the response comes back — this only starts the flow.
   */
  const signInWithGoogle = async () => {
    if (!googleSignInConfigured) {
      throw new Error(
        'Google sign-in is not configured. Set EXPO_PUBLIC_GOOGLE_*_CLIENT_ID.'
      );
    }
    const prompt = googlePromptRef.current;
    if (!prompt) {
      throw new Error('Google sign-in is still initialising. Try again in a moment.');
    }

    await prompt();
  };

  const signOut = async () => {
    try {
      await api.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      await storage.secureRemove('auth_token');
      // Tear down the socket too, otherwise it stays authenticated as the
      // previous user and keeps receiving their notifications.
      disconnectSocket();
      setUser(null);
    }
  };

  const refreshUser = async () => {
    try {
      const userData = await api.getMe();
      setUser(userData);
    } catch (error) {
      console.error('Refresh user error:', error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signUp,
        signIn,
        signInWithGoogle,
        signOut,
        refreshUser,
      }}
    >
      {googleSignInConfigured && (
        <GoogleAuthBridge promptRef={googlePromptRef} onIdToken={handleGoogleIdToken} />
      )}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
