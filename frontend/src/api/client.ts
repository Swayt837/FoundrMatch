/**
 * API Client for CoFoundr Backend
 */
import Constants from 'expo-constants';
import { storage } from '@/src/utils/storage';

export const API_URL: string | undefined =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_PUBLIC_BACKEND_URL;

if (!API_URL) {
  // Without this the base URL silently became "undefined/api" and every request
  // failed with an opaque network error.
  console.error(
    '[api] EXPO_PUBLIC_BACKEND_URL is not set. Copy frontend/.env.example to ' +
      'frontend/.env (or set it in app.json > expo.extra) and restart the bundler.'
  );
}

/**
 * Error thrown for any non-2xx response.
 *
 * Carries the HTTP status so callers can branch on it — `402` for the daily
 * swipe limit, `429` for rate limiting — instead of matching on message text,
 * which broke as soon as the server reworded a detail string.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }

  /** Free-tier swipe allowance exhausted. */
  get isPaymentRequired() {
    return this.status === 402;
  }

  get isRateLimited() {
    return this.status === 429;
  }

  get isNotFound() {
    return this.status === 404;
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler;
}

function toQueryString(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      qs.append(key, String(value));
    }
  });
  return qs.toString();
}

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
      if (unauthorizedHandler) unauthorizedHandler();
      throw new ApiError(401, 'Unauthorized');
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const detail =
        typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status})`;
      throw new ApiError(response.status, detail);
    }

    if (response.status === 204) return null;
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

  /**
   * Exchange a Google ID token for our own access token.
   *
   * The server verifies the token's signature, audience and verified-email claim
   * against Google before trusting any of it — see `verify_google_id_token`.
   */
  async googleCallback(idToken: string) {
    return this.request('/auth/google/callback', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken }),
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
    // Wrapped in an object: the endpoint expects a JSON body `{ photos: [...] }`.
    return this.request('/profile/photos', {
      method: 'POST',
      body: JSON.stringify({ photos }),
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

  async markMessagesRead(matchId: string) {
    return this.request(`/chat/${matchId}/read`, { method: 'POST' });
  }

  async unmatch(matchId: string) {
    return this.request(`/matches/${matchId}`, { method: 'DELETE' });
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

  async getDealRoomByMatch(matchId: string) {
    return this.request(`/matches/${matchId}/deal-room`);
  }

  async generateRoadmap(roomId: string) {
    return this.request(`/deal-rooms/${roomId}/generate-roadmap`, {
      method: 'POST',
    });
  }

  async addTask(roomId: string, title: string, description: string = '') {
    return this.request(`/deal-rooms/${roomId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ title, description }),
    });
  }

  async toggleTask(roomId: string, taskId: string) {
    return this.request(`/deal-rooms/${roomId}/tasks/${taskId}`, {
      method: 'PATCH',
    });
  }

  async addDealRoomDocument(
    roomId: string,
    document: { title: string; url: string; doc_type?: string; note?: string }
  ) {
    return this.request(`/deal-rooms/${roomId}/documents`, {
      method: 'POST',
      body: JSON.stringify(document),
    });
  }

  async removeDealRoomDocument(roomId: string, documentId: string) {
    return this.request(`/deal-rooms/${roomId}/documents/${documentId}`, {
      method: 'DELETE',
    });
  }

  async addDealRoomDecision(roomId: string, title: string, detail: string = '') {
    return this.request(`/deal-rooms/${roomId}/decisions`, {
      method: 'POST',
      body: JSON.stringify({ title, detail }),
    });
  }

  async agreeToDecision(roomId: string, decisionId: string) {
    return this.request(`/deal-rooms/${roomId}/decisions/${decisionId}/agree`, {
      method: 'POST',
    });
  }

  async proposeEquity(
    roomId: string,
    proposal: {
      splits: Record<string, number>;
      vesting_months?: number;
      cliff_months?: number;
      notes?: string;
    }
  ) {
    return this.request(`/deal-rooms/${roomId}/equity`, {
      method: 'PUT',
      body: JSON.stringify(proposal),
    });
  }

  async acceptEquity(roomId: string) {
    return this.request(`/deal-rooms/${roomId}/equity/accept`, { method: 'POST' });
  }

  // Calls — ICE servers only; the media is peer-to-peer and never hits the backend.
  async getCallConfig() {
    return this.request('/calls/config');
  }

  async getMatchCallConfig(matchId: string) {
    return this.request(`/matches/${matchId}/call-config`);
  }

  // Personality assessment
  async getPersonalityAssessment() {
    return this.request('/assessment/personality');
  }

  async submitPersonalityAssessment(answers: Record<string, number>) {
    return this.request('/assessment/personality', {
      method: 'POST',
      body: JSON.stringify({ answers }),
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

  async getProject(projectId: string) {
    return this.request(`/projects/${projectId}`);
  }

  async getMyProjects() {
    return this.request('/projects/mine');
  }

  async applyToProject(projectId: string, message: string = '') {
    return this.request(`/projects/${projectId}/apply`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  async getProjectApplicants(projectId: string) {
    return this.request(`/projects/${projectId}/applicants`);
  }

  async setProjectStatus(projectId: string, status: 'open' | 'closed') {
    return this.request(`/projects/${projectId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  // AI
  async getBusinessIdeas(matchId: string) {
    return this.request(`/ai/business-ideas/${matchId}`);
  }

  async copilotChat(message: string, history: any[] = []) {
    return this.request('/ai/copilot/chat', {
      method: 'POST',
      body: JSON.stringify({ message, history }),
    });
  }

  // Profile update
  async updateProfile(data: any) {
    return this.request('/profile/update', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Get another user's profile
  async getUserProfile(userId: string) {
    return this.request(`/profile/${userId}`);
  }

  // Premium
  async premiumCheckout(plan: 'lifetime' | 'monthly', originUrl: string) {
    return this.request('/premium/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan, origin_url: originUrl }),
    });
  }

  async premiumStatus(sessionId: string) {
    return this.request(`/premium/status/${sessionId}`);
  }

  async premiumMe() {
    return this.request('/premium/me');
  }

  /** Purchasable plans. Prices and availability are server-side, never hardcoded. */
  async getPremiumPlans() {
    return this.request('/premium/plans');
  }

  /** Cancel a subscription at the end of the paid period. */
  async cancelSubscription() {
    return this.request('/premium/cancel', { method: 'POST' });
  }

  // Discovery / Projects with filters
  async getDiscoveryCardsFiltered(params: {
    limit?: number;
    /** Stable cursor — the ranking is deterministic, so paging never reshuffles. */
    offset?: number;
    profession?: string;
    availability?: string;
    city?: string;
    country?: string;
  }) {
    return this.request(`/discovery/cards?${toQueryString(params)}`);
  }

  // Compatibility
  /** Full dimension breakdown plus the AI narrative, generated on demand. */
  async getCompatibility(userId: string) {
    return this.request(`/compatibility/${userId}`);
  }

  /** Premium: deep report with founder-risk detection. Throws ApiError 402 if not premium. */
  async getCompatibilityReport(userId: string) {
    return this.request(`/compatibility/${userId}/report`);
  }

  async getProjectsFiltered(params: {
    status?: string;
    limit?: number;
    looking_for?: string;
    skill?: string;
    min_hours?: number;
    max_hours?: number;
    min_equity?: number;
    max_equity?: number;
    my_city_only?: boolean;
  }) {
    return this.request(`/projects?${toQueryString(params)}`);
  }

  // Settings
  async getSettings() {
    return this.request('/settings');
  }

  async updateSettings(updates: {
    notifications_enabled?: boolean;
    distance_preference?: number;
    show_age?: boolean;
  }) {
    return this.request('/settings', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  // Moderation
  async blockUser(userId: string) {
    return this.request(`/users/${userId}/block`, { method: 'POST' });
  }

  async unblockUser(userId: string) {
    return this.request(`/users/${userId}/block`, { method: 'DELETE' });
  }

  async getBlockedUsers() {
    return this.request('/users/blocked');
  }

  async reportUser(
    userId: string,
    reason: string,
    details: string = '',
    alsoBlock: boolean = true
  ) {
    return this.request(`/users/${userId}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason, details, also_block: alsoBlock }),
    });
  }

  /** Irreversible. The backend requires the literal confirmation string. */
  async deleteAccount() {
    return this.request('/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
  }
}

export const api = new APIClient();
