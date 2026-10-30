# Demo script (about four minutes)

Screens: the stage app (`/`), a phone with the web app or the Expo app, and the stage's attack and numbers pages.
Rehearse with `pnpm agent` first; reset the attack between runs.

1. **The problem (30 s).** Stage, left panel only: ask "Best veg biryani under ₹400 near Calangute?". The open-web
   agent searches a sandboxed copy of the web where four pages push "Saffron Comet Biryani", a restaurant that does
   not exist. It recommends it; the tag shows how many of its sources were planted. (Sandbox page: full disclosure.)
2. **Receipts (45 s).** Same question, right panel, same model. It calls `search_receipts`, pays $0.005 in USDC over
   x402 (the transaction link appears), re-verifies one cited receipt for free, and answers with the trust score,
   verified buyers, the price they actually paid, and claims that each link to a receipt.
3. **Where reviews come from (75 s).** On the phone: prove a purchase (order page via Reclaim, or scan a merchant's
   signed QR), talk for fifteen seconds in any language, confirm the card, sign. Open the receipt page and press
   "Re-check": every check passes, and the attestation is on Base.
4. **Why it holds (45 s).** The attack page: five new accounts funded by one wallet give a bad place five stars. A
   plain average jumps from 2.27 to 3.13; the trust score moves from 3.45 to 3.54. The ring, the shared funder and
   the burst are flagged, and the investigator's case file cites the graph queries behind each finding.
5. **Who gets paid (30 s).** 70% of what the agent paid in step 2 accrued to the reviewers its answer cited (the
   leaderboard shows it). On the phone, Earnings is where your own share lands once an agent cites your review:
   claim USDC gaslessly or withdraw to UPI. Pay never depends on the rating.
6. **Close (15 s).** The week in numbers, live.

Say what is simulated when it shows: seeded demo merchants and reviews carry "(demo)" and "simulated" labels.
