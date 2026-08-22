import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/$locale/')({
  component: () => <div className="p-8">Home (placeholder)</div>,
})
