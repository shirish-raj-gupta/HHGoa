// What a visitor said brings them to Receipts, picked on the splash (components/splash.tsx) and kept in this browser.
// A plain module, so the root layout (a server component) can use splashScript().

export type Visitor = 'shopper' | 'reviewer' | 'business' | 'developer';

export const VISITOR_KEY = 'receipts.role';
const VISITORS: Visitor[] = ['shopper', 'reviewer', 'business', 'developer'];

export function readVisitor(): Visitor | null {
  try {
    const v = localStorage.getItem(VISITOR_KEY);
    return VISITORS.includes(v as Visitor) ? (v as Visitor) : null;
  } catch {
    return null;
  }
}

/** The splash shows once, until someone picks or skips. Without storage it never shows: it would return on every visit. */
export function splashDue(): boolean {
  try {
    return localStorage.getItem(VISITOR_KEY) === null;
  } catch {
    return false;
  }
}

export function saveVisitor(v: Visitor | 'skip') {
  try {
    localStorage.setItem(VISITOR_KEY, v);
  } catch {}
}

/** Runs in <head> before the first paint. On a first visit to the home page the page starts under navy, so the splash
 *  takes over without the page flashing first; the splash lifts the cover, and globals.css lifts it after four
 *  seconds whatever happens. */
export function splashScript(): string {
  return `try{if(location.pathname==='/'&&localStorage.getItem('${VISITOR_KEY}')===null)document.documentElement.setAttribute('data-splash','')}catch(e){}`;
}

export function liftSplashCover() {
  document.documentElement.removeAttribute('data-splash');
}
