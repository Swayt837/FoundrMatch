/**
 * Authentication Context for CoFound
 * Supports both email/password and Google OAuth
 */
import React, { createContext, useState, useContext, useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { storage } from '@/src/utils/storage';
import { api, setUnauthorizedHandler } from '@/src/api/client';
import { disconnectSocket } from '@/src/lib/socket';

WebBrowser.maybeCompleteAuthSession();

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

  useEffect(() => {
    // Setup 401 handler to force logout + redirect
    setUnauthorizedHandler(() => {
      disconnectSocket();
      setUser(null);
    });
    
    // Check for existing session on mount
    checkExistingSession();
    
    // Handle deep links (Google OAuth callback on mobile)
    const subscription = Linking.addEventListener('url', handleDeepLink);
    
    // Check initial URL (for cold starts)
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink({ url });
      }
    });
    
    return () => {
      subscription.remove();
    };
  }, []);

  const checkExistingSession = async () => {
    try {
      const token = await storage.secureGet('auth_token', null);
      if (token) {
        const userData = await api.getMe();
        setUser(userData);
      }
    } catch (error) {
      console.log('No existing session');
      await storage.secureRemove('auth_token');
    } finally {
      setLoading(false);
    }
  };

  const handleDeepLink = async ({ url }: { url: string }) => {
    // Parse session_id from URL (supports both hash and query params)
    let sessionId = null;
    
    if (url.includes('#session_id=')) {
      sessionId = url.split('#session_id=')[1].split('&')[0];
    } else if (url.includes('?session_id=')) {
      sessionId = url.split('?session_id=')[1].split('&')[0];
    }

    if (sessionId) {
      try {
        const response = await api.googleCallback(sessionId);
        await storage.secureSet('auth_token', response.session_token);
        const userData = await api.getMe();
        setUser(userData);
      } catch (error) {
        console.error('Google auth error:', error);
      }
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

  const signInWithGoogle = async () => {
    try {
      const redirectUrl = Platform.OS === 'web' 
        ? `${window.location.origin}/`
        : Linking.createURL('');
      
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

      if (Platform.OS === 'web') {
        window.location.href = authUrl;
      } else {
        const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
        
        if (result.type === 'success' && result.url) {
          await handleDeepLink({ url: result.url });
        }
      }
    } catch (error) {
      console.error('Google sign in error:', error);
      throw error;
    }
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
