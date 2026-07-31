import './globals.css';
import { inter, jetbrainsMono } from '@/lib/fonts';
import Providers from '@/components/app/Providers';

export const metadata = {
  title: 'CustomDB',
  description: 'Self-hosted Database-as-a-Service',
};

export default function RootLayout({ children }) {
  return (
    // `dark` activates the Operate console's dark token set (see globals.css).
    // The dashboard itself is dark-only, so this is unconditional rather than
    // a user-toggled theme.
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
