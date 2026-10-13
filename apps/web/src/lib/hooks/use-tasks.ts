import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Task } from '@orbit/domain';
import { apiFetch } from '../api-client';

export function useCompleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<Task>(`/v1/tasks/${id}/complete`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
