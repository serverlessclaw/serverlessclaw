import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/PageHeader';

export default function Loading() {
  return (
    <div className="flex-1 space-y-10">
      <PageHeader titleKey="WORKSPACES_TITLE" subtitleKey="WORKSPACES_SUBTITLE" />

      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="border border-border p-6 rounded-xl bg-card h-20 flex items-center gap-4"
          >
            <Skeleton className="w-10 h-10 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="w-32 h-4" />
              <Skeleton className="w-24 h-3" />
            </div>
            <Skeleton className="w-4 h-4" />
          </div>
        ))}
      </div>
    </div>
  );
}
