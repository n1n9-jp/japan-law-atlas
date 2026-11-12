import type { Metadata } from 'next';
import { Noto_Sans_JP, Noto_Serif_JP } from 'next/font/google';
import './globals.css';

const sans = Noto_Sans_JP({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  adjustFontFallback: false,
});

const serif = Noto_Serif_JP({
  weight: ['400', '600'],
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: '法令アトラス',
  description: '日本の施行中の全法令の参照ネットワーク地図',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ja" className={`${sans.variable} ${serif.variable}`}>
      <body className={sans.className}>{children}</body>
    </html>
  );
}
