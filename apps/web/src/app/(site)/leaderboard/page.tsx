import { connection } from 'next/server';
import { Card, PageTitle, SimulatedTag } from '@receipts/react';
import { serverClient } from '@/lib/server-api';

export const metadata = { title: 'Leaderboard' };

export default async function Leaderboard() {
  await connection();
  const rows = await serverClient.leaderboard(25).catch(() => null);
  return (
    <div>
      <PageTitle eyebrow="Leaderboard" title="Most-cited reviewers" sub="Earned from agents citing their reviews. Wallets are shortened; nothing else about a reviewer is public." />
      {!rows ? (
        <Card className="text-sm text-muted">The API is not reachable right now.</Card>
      ) : (
        <Card className="p-0!">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Reviewer</th>
                <th className="px-4 py-3 font-medium">Level</th>
                <th className="px-4 py-3 font-medium">Reviews</th>
                <th className="px-4 py-3 text-right font-medium">Earned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.reviewerId} className="border-t border-line">
                  <td className="px-4 py-2.5 text-muted">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs">{r.reviewer}</span> <SimulatedTag show={r.simulated} />
                  </td>
                  <td className="px-4 py-2.5">{r.level}</td>
                  <td className="px-4 py-2.5">{r.reviews}</td>
                  <td className="px-4 py-2.5 text-right font-mono">${Number(r.earnedUsdc).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
