const nodemailer = require('nodemailer');

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  if (process.env.SMTP_URL) {
    cachedTransporter = nodemailer.createTransport(process.env.SMTP_URL);
    return cachedTransporter;
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return cachedTransporter;
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const from = process.env.MAIL_FROM || 'CustomDB <no-reply@customdb.local>';
  const transporter = getTransporter();

  if (!transporter) {
    console.log(`[password-reset] SMTP not configured. Reset link for ${to}: ${resetUrl}`);
    return { delivered: false };
  }

  await transporter.sendMail({
    from,
    to,
    subject: 'Reset your CustomDB password',
    text: [
      'Use this link to reset your CustomDB password:',
      resetUrl,
      '',
      'This link expires in 30 minutes. If you did not request it, you can ignore this email.',
    ].join('\n'),
    html: `
      <p>Use this link to reset your CustomDB password:</p>
      <p><a href="${resetUrl}">Reset password</a></p>
      <p>This link expires in 30 minutes. If you did not request it, you can ignore this email.</p>
    `,
  });
  return { delivered: true };
}

module.exports = { sendPasswordResetEmail };
