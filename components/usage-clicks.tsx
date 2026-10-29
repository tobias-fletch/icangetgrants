'use client';
import { useEffect } from 'react';
import { sendUsage } from '@/lib/usage-beacon';

// On the server-rendered /grants pages, a listing title links straight to the official source, so a click
// there counts as an outbound apply click. Links opt in with data-usage="apply_click". Renders nothing.
export function UsageClicks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[data-usage="apply_click"]');
      if (a) sendUsage('apply_click');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  return null;
}
