import { cn } from '@/lib/utils'

/** The lab mark: a small grid with one lit cell — "a concept, isolated". */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn('size-6', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" opacity="0.45" />
      <rect x="9.75" y="9.75" width="4.5" height="4.5" rx="1" fill="var(--accent)" stroke="none" />
    </svg>
  )
}
