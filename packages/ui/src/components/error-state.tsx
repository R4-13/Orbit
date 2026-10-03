import { Button } from './button';
import { cn } from '../lib/cn';

export interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

/** UI-7 ("Accessibility and responsive hardening... error states", ORION_UI_UX_DEVELOPMENT_SPECIFICATION_v1.md) — the shared error presentation for a failed primary page query, distinct from the existing per-field/per-mutation inline red text used for form submissions. */
export function ErrorState({ message, onRetry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-red-100 bg-red-50 px-6 py-8 text-center',
        className,
      )}
    >
      <p className="text-sm text-red-700">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Erneut versuchen
        </Button>
      ) : null}
    </div>
  );
}
