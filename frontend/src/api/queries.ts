/**
 * react-query hooks for the API.
 *
 * `@tanstack/react-query` was a dependency from the start but was never used: every
 * screen ran its own `useState` + `useFocusEffect(() => load())`, which meant a full
 * spinner on every focus even when the data was seconds old, no request dedupe
 * between screens, and a hand-written reload after each mutation.
 *
 * These hooks give cached-first rendering with a background refresh, and mutations
 * that invalidate exactly the queries they affect.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';

import { api } from '@/src/api/client';

/**
 * Query keys in one place so an invalidation can never miss a screen by typo.
 * Hierarchical: invalidating `['matches']` also invalidates `['matches', id]`.
 */
export const queryKeys = {
  matches: ['matches'] as const,
  projects: (filters?: unknown) => ['projects', filters ?? {}] as const,
  project: (id: string) => ['projects', 'detail', id] as const,
  projectApplicants: (id: string) => ['projects', 'applicants', id] as const,
  myProjects: ['projects', 'mine'] as const,
  discovery: (filters?: unknown) => ['discovery', filters ?? {}] as const,
  profile: (id: string) => ['profile', id] as const,
  compatibility: (id: string) => ['compatibility', id] as const,
  settings: ['settings'] as const,
  blocked: ['blocked'] as const,
  premium: ['premium'] as const,
  premiumPlans: ['premium', 'plans'] as const,
};

/** Matches move often (new message, unread count), so keep them fresh-ish. */
export function useMatches(options?: Partial<UseQueryOptions<any>>) {
  return useQuery({
    queryKey: queryKeys.matches,
    queryFn: () => api.getMatches(),
    staleTime: 15_000,
    ...options,
  });
}

export function useUnmatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (matchId: string) => api.unmatch(matchId),
    // Drop the row immediately; the invalidation reconciles with the server.
    onMutate: async (matchId: string) => {
      const previous = queryClient.getQueryData<any>(queryKeys.matches);
      queryClient.setQueryData<any>(queryKeys.matches, (current: any) =>
        current
          ? { ...current, matches: current.matches.filter((m: any) => m.match_id !== matchId) }
          : current
      );
      return { previous };
    },
    onError: (_error, _matchId, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.matches, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.matches }),
  });
}

export interface ProjectFilters {
  status?: string;
  limit?: number;
  looking_for?: string;
  skill?: string;
  min_hours?: number;
  max_hours?: number;
  min_equity?: number;
  max_equity?: number;
  my_city_only?: boolean;
}

export function useProjects(filters: ProjectFilters) {
  return useQuery({
    queryKey: queryKeys.projects(filters),
    queryFn: () => api.getProjectsFiltered(filters),
    // Filter changes should show the previous list rather than an empty spinner.
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useProject(projectId?: string) {
  return useQuery({
    queryKey: queryKeys.project(projectId ?? ''),
    queryFn: () => api.getProject(projectId as string),
    enabled: !!projectId,
  });
}

export function useProjectApplicants(projectId?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.projectApplicants(projectId ?? ''),
    queryFn: () => api.getProjectApplicants(projectId as string),
    enabled: !!projectId && enabled,
  });
}

export function useApplyToProject(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => api.applyToProject(projectId, message),
    onSuccess: () => {
      // `has_applied` and `applicants_count` change on both the detail and the list.
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useSetProjectStatus(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: 'open' | 'closed') => api.setProjectStatus(projectId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export interface DiscoveryFilters {
  limit?: number;
  offset?: number;
  profession?: string;
  availability?: string;
  city?: string;
  country?: string;
}

/**
 * The swipe feed.
 *
 * `staleTime: Infinity` on purpose: the deck is consumed card by card with local
 * index state, so a background refetch mid-deck would shuffle the cards under the
 * user's thumb. Refresh explicitly instead.
 */
export function useDiscoveryCards(filters: DiscoveryFilters, enabled = true) {
  return useQuery({
    queryKey: queryKeys.discovery(filters),
    queryFn: () => api.getDiscoveryCardsFiltered(filters),
    enabled,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
}

/**
 * Someone else's public profile.
 *
 * The API nests the editable fields under `profile`; every screen wants them flat,
 * so the shape is normalised once here instead of in each caller.
 */
export function useUserProfile(userId?: string) {
  return useQuery({
    queryKey: queryKeys.profile(userId ?? ''),
    queryFn: () => api.getUserProfile(userId as string),
    enabled: !!userId,
    select: (data: any) =>
      data?.profile ? { user_id: data.user_id, premium: data.premium, ...data.profile } : data,
  });
}

/** Full breakdown plus the AI narrative. Cached hard — the backend caches it too. */
export function useCompatibility(userId?: string) {
  return useQuery({
    queryKey: queryKeys.compatibility(userId ?? ''),
    queryFn: () => api.getCompatibility(userId as string),
    enabled: !!userId,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/**
 * The premium deep report. A mutation rather than a query because it costs an LLM
 * call and is only produced when the user asks for it.
 */
export function useCompatibilityReport(userId?: string) {
  return useMutation({
    mutationFn: () => api.getCompatibilityReport(userId as string),
  });
}

export function usePremiumStatus() {
  return useQuery({
    queryKey: queryKeys.premium,
    queryFn: () => api.premiumMe(),
    staleTime: 60_000,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.getSettings(),
    staleTime: 60_000,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: Record<string, unknown>) => api.updateSettings(updates),
    // Switches have to flip under the finger; a failure rolls the cache back.
    onMutate: async (updates: Record<string, unknown>) => {
      const previous = queryClient.getQueryData<any>(queryKeys.settings);
      queryClient.setQueryData<any>(queryKeys.settings, (current: any) =>
        current ? { ...current, ...updates } : current
      );
      return { previous };
    },
    onError: (_error, _updates, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.settings, context.previous);
    },
    onSuccess: (saved) => queryClient.setQueryData(queryKeys.settings, saved),
  });
}

export function useBlockedUsers() {
  return useQuery({
    queryKey: queryKeys.blocked,
    queryFn: () => api.getBlockedUsers(),
  });
}

export function useUnblockUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.unblockUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.blocked });
      // An unblocked founder becomes discoverable again.
      queryClient.invalidateQueries({ queryKey: ['discovery'] });
    },
  });
}

export function useCancelSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.cancelSubscription(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.premium }),
  });
}

export function usePremiumPlans() {
  return useQuery({
    queryKey: queryKeys.premiumPlans,
    queryFn: () => api.getPremiumPlans(),
    staleTime: 10 * 60_000,
  });
}
