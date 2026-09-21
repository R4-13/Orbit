import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Task, TaskStatus } from '@orbit/domain';
import { apiFetch } from '../api-client';

export function useTasks(status?: TaskStatus) {
  return useQuery({
    queryKey: ['tasks', status ?? 'all'],
    queryFn: () => apiFetch<Task[]>(`/v1/tasks${status ? `?status=${status}` : ''}`),
  });
}

export function useCompleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<Task>(`/v1/tasks/${id}/complete`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
