import type { Metadata } from 'next';
import './globals.scss';

export const metadata: Metadata = {
  title: 'YT Reminder',
  description: 'A daily email with one YouTube video you haven\'t watched yet, from the channels you want to learn from.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
