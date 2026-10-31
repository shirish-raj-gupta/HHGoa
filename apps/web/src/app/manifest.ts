import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '₹eceipt',
    short_name: '₹eceipt',
    description: 'No receipt, no review. Verified reviews of what you bought; get paid when AI agents cite them.',
    start_url: '/review',
    display: 'standalone',
    background_color: '#f3e7d7',
    theme_color: '#f3e7d7',
    icons: [
      { src: '/icon.svg?v=rupee-1', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png?v=rupee-1', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png?v=rupee-1', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png?v=rupee-1', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
