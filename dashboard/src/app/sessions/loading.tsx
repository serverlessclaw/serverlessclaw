import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/PageHeader';

export default function Loading() {
  return (
    <div className="flex-1 space-y-10">
      <PageHeader titleKey="SESSIONS_TITLE" subtitleKey="SESSIONS_SUBTITLE" />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="bg-card/60 backdrop-blur-xl border border-border p-6 rounded-xl h-48"
          >
            <Skeleton className="w-10 h-10 rounded-lg mb-4" />
            <Skeleton className="w-3/4 h-6 mb-2" />
            <Skeleton className="w-1/2 h-4 mb-6" />
            <div className="pt-4 border-t border-border flex justify-between">
              <Skeleton className="w-20 h-4" />
              <Skeleton className="w-20 h-4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
