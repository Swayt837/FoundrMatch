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
import { pickAndUploadDocument } from '@/src/utils/documents';

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
  dealRoom: (matchId: string) => ['deal-room', matchId] as const,
  personality: ['assessment', 'personality'] as const,
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

/**
 * Decide on an applicant.
 *
 * Accepting creates a match, so the matches list is invalidated too — the new
 * conversation should be there when the owner goes looking for it.
 */
export function useDecideApplicant(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ applicantId, decision }: { applicantId: string; decision: 'accept' | 'decline' }) =>
      decision === 'accept'
        ? api.acceptApplicant(projectId, applicantId)
        : api.declineApplicant(projectId, applicantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.matches });
    },
  });
}

export function useWithdrawApplication(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.withdrawApplication(projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
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

/**
 * The deal room for a match.
 *
 * Everything in the room (tasks, documents, decisions, equity) lives in one
 * document, so every mutation below just invalidates this one query rather than
 * patching six slices of cache by hand.
 */
export function useDealRoom(matchId?: string) {
  return useQuery({
    queryKey: queryKeys.dealRoom(matchId ?? ''),
    queryFn: () => api.getDealRoomByMatch(matchId as string),
    enabled: !!matchId,
    select: (data: any) => data?.room ?? null,
  });
}

/**
 * Mutations against a room. Grouped in one hook because they all invalidate the
 * same query and every caller needs several of them.
 */
export function useDealRoomActions(matchId: string, roomId?: string) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.dealRoom(matchId) });

  const create = useMutation({
    mutationFn: (payload: { projectName: string; vision: string }) =>
      api.createDealRoom(matchId, payload.projectName, payload.vision),
    onSuccess: (room: any) =>
      // The response *is* the room, so seed the cache with it instead of making
      // the screen wait for a refetch before it can render.
      queryClient.setQueryData(queryKeys.dealRoom(matchId), { room }),
  });

  const addTask = useMutation({
    mutationFn: (title: string) => api.addTask(roomId as string, title),
    onSuccess: invalidate,
  });

  const toggleTask = useMutation({
    mutationFn: (taskId: string) => api.toggleTask(roomId as string, taskId),
    onSuccess: invalidate,
  });

  const generateRoadmap = useMutation({
    mutationFn: () => api.generateRoadmap(roomId as string),
    onSuccess: invalidate,
  });

  /** Turn one roadmap phase into real tasks. Skips titles already in the list. */
  const importRoadmapPhase = useMutation({
    mutationFn: (phaseIndex: number) =>
      api.importRoadmapPhase(roomId as string, phaseIndex),
    onSuccess: invalidate,
  });

  const addObjective = useMutation({
    mutationFn: (payload: { title: string; target_date?: string }) =>
      api.addDealRoomObjective(roomId as string, payload),
    onSuccess: invalidate,
  });

  const toggleObjective = useMutation({
    mutationFn: (objectiveId: string) =>
      api.toggleDealRoomObjective(roomId as string, objectiveId),
    onSuccess: invalidate,
  });

  const removeObjective = useMutation({
    mutationFn: (objectiveId: string) =>
      api.removeDealRoomObjective(roomId as string, objectiveId),
    onSuccess: invalidate,
  });

  const addNote = useMutation({
    mutationFn: (content: string) => api.addDealRoomNote(roomId as string, content),
    onSuccess: invalidate,
  });

  const removeNote = useMutation({
    mutationFn: (noteId: string) => api.removeDealRoomNote(roomId as string, noteId),
    onSuccess: invalidate,
  });

  const addDocument = useMutation({
    mutationFn: (document: {
      title: string;
      url?: string;
      storage_key?: string;
      filename?: string;
      size_bytes?: number;
      doc_type?: string;
    }) => api.addDealRoomDocument(roomId as string, document),
    onSuccess: invalidate,
  });

  /**
   * Pick a file, upload it, then record it — in that order, so the room never
   * holds an entry pointing at a transfer that failed. Resolves to null when
   * the user cancels the picker.
   */
  const uploadDocument = useMutation({
    mutationFn: async (payload: { title: string; doc_type?: string }) => {
      const picked = await pickAndUploadDocument(roomId as string);
      if (!picked) return null;
      return api.addDealRoomDocument(roomId as string, {
        title: payload.title.trim() || picked.filename,
        doc_type: payload.doc_type,
        storage_key: picked.storage_key,
        filename: picked.filename,
        size_bytes: picked.size_bytes,
      });
    },
    onSuccess: invalidate,
  });

  const signDocument = useMutation({
    mutationFn: (documentId: string) => api.signDocument(roomId as string, documentId),
    onSuccess: invalidate,
  });

  /**
   * Pick a replacement file and attach it as a new version. Resolves to null
   * when the picker is dismissed.
   */
  const replaceDocument = useMutation({
    mutationFn: async (documentId: string) => {
      const picked = await pickAndUploadDocument(roomId as string);
      if (!picked) return null;
      return api.addDocumentVersion(roomId as string, documentId, {
        storage_key: picked.storage_key,
        filename: picked.filename,
        size_bytes: picked.size_bytes,
      });
    },
    onSuccess: invalidate,
  });

  const removeDocument = useMutation({
    mutationFn: (documentId: string) =>
      api.removeDealRoomDocument(roomId as string, documentId),
    onSuccess: invalidate,
  });

  const addDecision = useMutation({
    mutationFn: (payload: { title: string; detail?: string }) =>
      api.addDealRoomDecision(roomId as string, payload.title, payload.detail ?? ''),
    onSuccess: invalidate,
  });

  const agreeToDecision = useMutation({
    mutationFn: (decisionId: string) => api.agreeToDecision(roomId as string, decisionId),
    onSuccess: invalidate,
  });

  const proposeEquity = useMutation({
    mutationFn: (proposal: {
      splits: Record<string, number>;
      vesting_months?: number;
      cliff_months?: number;
      notes?: string;
    }) => api.proposeEquity(roomId as string, proposal),
    onSuccess: invalidate,
  });

  const acceptEquity = useMutation({
    mutationFn: () => api.acceptEquity(roomId as string),
    onSuccess: invalidate,
  });

  return {
    create,
    addTask,
    toggleTask,
    generateRoadmap,
    importRoadmapPhase,
    addObjective,
    toggleObjective,
    removeObjective,
    addNote,
    removeNote,
    addDocument,
    uploadDocument,
    signDocument,
    replaceDocument,
    removeDocument,
    addDecision,
    agreeToDecision,
    proposeEquity,
    acceptEquity,
  };
}

/** Questionnaire plus the current user's own answers, so it stays editable. */
export function usePersonalityAssessment() {
  return useQuery({
    queryKey: queryKeys.personality,
    queryFn: () => api.getPersonalityAssessment(),
    staleTime: 5 * 60_000,
  });
}

export function useSubmitPersonalityAssessment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (answers: Record<string, number>) =>
      api.submitPersonalityAssessment(answers),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.personality });
      // The assessment feeds `personality_score`, so every score on screen is now
      // out of date.
      queryClient.invalidateQueries({ queryKey: queryKeys.matches });
      queryClient.invalidateQueries({ queryKey: ['discovery'] });
      queryClient.invalidateQueries({ queryKey: ['compatibility'] });
    },
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
