import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/PageHeader';

export default function Loading() {
  return (
    <div className="flex-1 space-y-10">
      <PageHeader titleKey="MEMORY_RESERVE" subtitleKey="MEMORY_SUBTITLE" />

      <div className="flex gap-1 w-fit mb-8">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="w-32 h-10 rounded-sm" />
        ))}
      </div>

      <div className="max-w-6xl space-y-4">
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} className="w-full h-16 rounded-sm" />
        ))}
      </div>
    </div>
  );
}
