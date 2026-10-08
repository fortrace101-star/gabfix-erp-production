import { createFileRoute } from '@tanstack/react-router';
import Portal from '@/components/Portal';

export const Route = createFileRoute('/')({
  head: () => ({ meta: [
    { title: 'Gabfix Employee Portal | Your Workspace' },
    { name: 'description', content: 'Gabfix Home Solutions employee workspace for jobs, sales, support, schedules and team activity.' },
    { property: 'og:title', content: 'Gabfix Employee Portal' },
    { property: 'og:description', content: 'Your work, your team, and your next step in one Gabfix workspace.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Portal,
});
