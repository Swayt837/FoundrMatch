/**
 * API Client for CoFound Backend
 */
import Constants from 'expo-constants';
import { storage } from '@/src/utils/storage';

const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_PUBLIC_BACKEND_URL;

class APIClient {
  private baseURL: string;

  constructor() {
    this.baseURL = `${API_URL}/api`;
  }

  private async getAuthHeader(): Promise<HeadersInit> {
    const token = await storage.secureGet('auth_token', null);
    if (token) {
      return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
    }
    return {
      'Content-Type': 'application/json',
    };
  }

  async request(endpoint: string, options: RequestInit = {}) {
    const headers = await this.getAuthHeader();
    
    const config: RequestInit = {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    };

    const response = await fetch(`${this.baseURL}${endpoint}`, config);
    
    if (response.status === 401) {
      // Token expired or invalid
      await storage.secureRemove('auth_token');
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || 'Request failed');
    }

    return response.json();
  }

  // Auth endpoints
  async register(email: string, password: string, name: string) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
  }

  async login(email: string, password: string) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async googleCallback(sessionId: string) {
    return this.request('/auth/google/callback', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    });
  }

  async getMe() {
    return this.request('/auth/me');
  }

  async logout() {
    return this.request('/auth/logout', { method: 'POST' });
  }

  // Onboarding
  async completeOnboarding(data: any) {
    return this.request('/onboarding/complete', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async uploadPhotos(photos: string[]) {
    return this.request('/profile/photos', {
      method: 'POST',
      body: JSON.stringify(photos),
    });
  }

  // Discovery
  async getDiscoveryCards(limit: number = 10) {
    return this.request(`/discovery/cards?limit=${limit}`);
  }

  async swipe(targetUserId: string, direction: 'left' | 'right') {
    return this.request('/swipe', {
      method: 'POST',
      body: JSON.stringify({ target_user_id: targetUserId, direction }),
    });
  }

  // Matches
  async getMatches() {
    return this.request('/matches');
  }

  // Chat
  async getMessages(matchId: string, limit: number = 50) {
    return this.request(`/chat/${matchId}/messages?limit=${limit}`);
  }

  async sendMessage(matchId: string, content: string) {
    return this.request(`/chat/${matchId}/send`, {
      method: 'POST',
      body: JSON.stringify({ match_id: matchId, content }),
    });
  }

  // Deal Rooms
  async createDealRoom(matchId: string, projectName: string, vision: string) {
    return this.request('/deal-rooms/create', {
      method: 'POST',
      body: JSON.stringify({ match_id: matchId, project_name: projectName, vision }),
    });
  }

  async getDealRoom(roomId: string) {
    return this.request(`/deal-rooms/${roomId}`);
  }

  async generateRoadmap(roomId: string) {
    return this.request(`/deal-rooms/${roomId}/generate-roadmap`, {
      method: 'POST',
    });
  }

  // Projects
  async createProject(data: any) {
    return this.request('/projects/create', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getProjects(status: string = 'open', limit: number = 20) {
    return this.request(`/projects?status=${status}&limit=${limit}`);
  }

  // AI
  async getBusinessIdeas(matchId: string) {
    return this.request(`/ai/business-ideas/${matchId}`);
  }
}

export const api = new APIClient();
