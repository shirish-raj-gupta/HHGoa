// Shared by the root layouts (server) and ThemeToggle (client): where the choice is kept, the browser-bar colour of
// each theme, and the inline script that applies a saved choice before the first paint, so it never flashes.

export type ThemeName = 'light' | 'dark';

export const THEME_KEY = 'receipts.theme';
export const THEME_COLOR: Record<ThemeName, string> = { light: '#f3e7d7', dark: '#030f24' };

/** For the root layout's <head>: applies a saved theme, else the fallback ('system' leaves it to the system). */
export function themeScript(fallback: 'system' | ThemeName = 'system'): string {
  const initial = fallback === 'system' ? 'null' : `'${fallback}'`;
  return `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark')t=${initial};if(t){document.documentElement.dataset.theme=t;var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute('content',t==='dark'?'${THEME_COLOR.dark}':'${THEME_COLOR.light}')}}catch(e){}})();`;
}
