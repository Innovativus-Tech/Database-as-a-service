import './globals.css';
import { AuthProvider } from '@/lib/auth';
import Nav from '@/components/Nav';

export const metadata = {
  title: 'CustomDB',
  description: 'Self-hosted Database-as-a-Service',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <Nav />
          <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
