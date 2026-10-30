import { SettleNow } from '@/components/settle-now';
import { StatsView } from '@/components/stats-view';

export const metadata = { title: 'The week in numbers · Receipts' };

export default function StatsPage() {
  return (
    <div className="space-y-10">
      <StatsView />
      <SettleNow />
    </div>
  );
}
