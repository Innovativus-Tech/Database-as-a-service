import nodemailer from 'nodemailer';

/**
 * Sends an alert email via SMTP. Silently logs and returns if SMTP_HOST
 * is not configured — so devs without an SMTP relay still get a working
 * alert pipeline (webhooks + UI banner still fire).
 */
export async function sendAlertEmail(
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  if (!process.env.SMTP_HOST) {
    console.warn('[Alert] SMTP not configured, skipping email to', to);
    return;
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  await transporter.sendMail({
    // MAIL_FROM is the platform-wide sender (used by password-reset mail and
    // set by docker-compose); SMTP_FROM is PivotDB's original name for the
    // same thing and is kept first for anyone carrying that env over. Without
    // the MAIL_FROM fallback, alert mail went out from the raw SMTP_USER
    // address while every other email used the branded sender.
    from: process.env.SMTP_FROM ?? process.env.MAIL_FROM ?? process.env.SMTP_USER ?? 'alerts@customdb',
    to,
    subject: `[CustomDB Alert] ${subject}`,
    text: body,
  });
}
