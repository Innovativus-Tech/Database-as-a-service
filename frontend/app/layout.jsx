import './globals.css';
import { inter, jetbrainsMono } from '@/lib/fonts';
import Providers from '@/components/app/Providers';

export const metadata = {
  title: 'CustomDB',
  description: 'Self-hosted Database-as-a-Service',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
