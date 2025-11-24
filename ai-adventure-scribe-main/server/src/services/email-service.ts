/**
 * Email Service
 *
 * Handles sending emails via Resend.
 * Used for waitlist confirmations, transactional emails, etc.
 */

import { Resend } from 'resend';

// Initialize Resend with API key from environment
const resend = new Resend(process.env.RESEND_API_KEY);

export interface WaitlistEmailParams {
  email: string;
  name?: string;
}

/**
 * Send waitlist confirmation email
 */
export async function sendWaitlistConfirmation(params: WaitlistEmailParams): Promise<void> {
  const { email, name } = params;
  const firstName = name?.split(' ')[0] || 'Adventurer';

  try {
    await resend.emails.send({
      from: 'Rob@infiniterealms.app',
      to: email,
      subject: '🎲 Welcome to the Infinite Realms Waitlist!',
      html: getWaitlistEmailHTML(firstName),
      text: getWaitlistEmailText(firstName),
    });

    console.log(`✅ Waitlist confirmation email sent to: ${email}`);
  } catch (error) {
    console.error('❌ Failed to send waitlist email:', error);
    throw new Error('Failed to send confirmation email');
  }
}

/**
 * Generate HTML email template for waitlist confirmation
 */
function getWaitlistEmailHTML(firstName: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Infinite Realms</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0f0f23; color: #e0e0e0;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background-color: #1a1a2e; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);">

          <!-- Header with gradient -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
              <h1 style="margin: 0; font-size: 32px; font-weight: bold; color: #ffffff; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);">
                🎲 Infinite Realms
              </h1>
              <p style="margin: 10px 0 0; font-size: 16px; color: #f0e6ff;">
                AI-Powered D&D Adventures
              </p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px; font-size: 24px; color: #ffffff; font-weight: 600;">
                Hey ${firstName}! 👋
              </h2>

              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #b8b8d0;">
                You're officially on the waitlist for <strong style="color: #8b7fe6;">Infinite Realms</strong> — the AI-powered platform that brings your D&D adventures to life like never before.
              </p>

              <div style="background-color: #252540; border-left: 4px solid #667eea; padding: 20px; margin: 30px 0; border-radius: 6px;">
                <h3 style="margin: 0 0 15px; font-size: 18px; color: #ffffff; font-weight: 600;">
                  ✨ What to Expect
                </h3>
                <ul style="margin: 0; padding-left: 20px; color: #b8b8d0; line-height: 1.8;">
                  <li>Early access when we launch</li>
                  <li>Behind-the-scenes development updates</li>
                  <li>Exclusive beta testing opportunities</li>
                  <li>Special launch pricing for waitlist members</li>
                </ul>
              </div>

              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #b8b8d0;">
                We're building something magical, and I can't wait to have you as part of this journey. Follow along on <a href="https://x.com/infiniterealms" style="color: #8b7fe6; text-decoration: none; font-weight: 600;">X (@infiniterealms)</a> for the latest updates and sneak peeks!
              </p>

              <div style="margin: 30px 0; text-align: center;">
                <a href="https://infiniterealms.app" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);">
                  Visit Infinite Realms
                </a>
              </div>

              <p style="margin: 30px 0 0; font-size: 16px; line-height: 1.6; color: #b8b8d0;">
                Thanks for believing in the vision,<br>
                <strong style="color: #8b7fe6;">Rob</strong><br>
                <span style="font-size: 14px; color: #7a7a95;">Founder, Infinite Realms</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #16162e; padding: 30px; text-align: center; border-top: 1px solid #2a2a44;">
              <p style="margin: 0 0 10px; font-size: 14px; color: #7a7a95;">
                Follow us:
                <a href="https://x.com/infiniterealms" style="color: #8b7fe6; text-decoration: none; font-weight: 600;">X</a> ·
                <a href="https://infiniterealms.app" style="color: #8b7fe6; text-decoration: none; font-weight: 600;">Website</a>
              </p>
              <p style="margin: 0; font-size: 12px; color: #5a5a75;">
                © 2025 Infinite Realms. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generate plain text email for waitlist confirmation
 */
function getWaitlistEmailText(firstName: string): string {
  return `
Hey ${firstName}! 👋

You're officially on the waitlist for Infinite Realms — the AI-powered platform that brings your D&D adventures to life like never before.

✨ What to Expect:
- Early access when we launch
- Behind-the-scenes development updates
- Exclusive beta testing opportunities
- Special launch pricing for waitlist members

We're building something magical, and I can't wait to have you as part of this journey. Follow along on X (@infiniterealms) for the latest updates and sneak peeks!

Visit us: https://infiniterealms.app
Follow us on X: https://x.com/infiniterealms

Thanks for believing in the vision,
Rob
Founder, Infinite Realms

---
© 2025 Infinite Realms. All rights reserved.
  `.trim();
}
