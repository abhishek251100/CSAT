import { createFileRoute, redirect } from '@tanstack/react-router'

/** Legacy path — Feedback & Actionables moved to A tracker. */
export const Route = createFileRoute('/actionables')({
  beforeLoad: () => {
    throw redirect({ to: '/tracker' })
  },
})
