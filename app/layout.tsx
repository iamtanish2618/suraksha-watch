import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = { title: 'Suraksha Watch | Worker Safety', description: 'Environmental safety monitoring for field workers.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
