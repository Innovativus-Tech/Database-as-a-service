const { z } = require('zod');

// Shared field schemas — every auth endpoint validates through these so the
// rules (and their error messages) can never drift between routes.
const emailSchema = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .email('Invalid email address')
  .max(254, 'Email is too long');

const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long');

const nameSchema = (label) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(80, `${label} is too long`);

const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: nameSchema('Full name'),
  organizationName: nameSchema('Organization name'),
});

const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  totp: z.string().trim().regex(/^\d{6}$/, 'Invalid 2FA code').optional(),
});

const forgotPasswordSchema = z.object({
  email: emailSchema,
});

const resetPasswordSchema = z.object({
  token: z.string({ required_error: 'Reset token is required' }).trim().min(1, 'Reset token is required'),
  password: passwordSchema,
});

const changePasswordSchema = z.object({
  currentPassword: z.string({ required_error: 'Current password is required' }),
  newPassword: passwordSchema,
});

const updateProfileSchema = z
  .object({
    displayName: z.string().trim().max(80).optional(),
    fullName: z.string().trim().max(80).optional(),
    organizationName: z.string().trim().max(80).optional(),
    avatarUrl: z
      .string()
      .max(600_000, 'Image too large (max ~400KB)')
      .refine(
        (v) => v === '' || /^data:image\/(png|jpe?g|webp|gif);base64,/.test(v),
        'avatarUrl must be a base64 image data URL'
      )
      .optional(),
  })
  .strip();

// Express helper: parse req.body with `schema`; on success replace req.body
// with the parsed (trimmed/normalized) data, on failure 400 with the first
// issue's message — matching the error shape the frontend already expects.
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const issue = result.error.issues[0];
      return res.status(400).json({ error: issue?.message || 'Invalid request body' });
    }
    req.body = result.data;
    next();
  };
}

module.exports = {
  validate,
  signupSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  updateProfileSchema,
};
