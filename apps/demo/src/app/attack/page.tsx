import { Eyebrow } from '@receipts/react';
import { AttackView } from '@/components/attack-view';

export const metadata = { title: 'The attack · Receipts' };

export default function AttackPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Eyebrow>Simulated attack</Eyebrow>
        <h1 className="text-4xl leading-[1.05] font-extrabold sm:text-5xl">What happens when someone games it</h1>
      </div>
      <AttackView />
    </div>
  );
}
