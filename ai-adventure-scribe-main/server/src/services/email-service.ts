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
      subject: '🎲 Your Party Awaits',
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
  <title>Your Party Awaits</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0f0f23; color: #e0e0e0;">

  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #0f0f23;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <!-- Main Container -->
        <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background-color: #151525; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6); border: 1px solid #2a2a44;">

          <!-- Header with Mystical Gradient -->
          <tr>
            <td style="background: linear-gradient(180deg, #2e1065 0%, #0f0f23 100%); padding: 40px 30px; text-align: center; border-bottom: 1px solid #3b0764;">
              <!-- Logo / Emoji Icon -->
              <div style="font-size: 48px; margin-bottom: 10px;">🎲</div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #ffffff; letter-spacing: 0.5px; text-transform: uppercase;">
                Infinite Realms
              </h1>
              <p style="margin: 8px 0 0; font-size: 14px; color: #d8b4fe; font-weight: 500; letter-spacing: 1px; text-transform: uppercase;">
                The Campaign That Never Cancels
              </p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px 30px;">

              <!-- Personal Greeting -->
              <h2 style="margin: 0 0 20px; font-size: 22px; color: #ffffff; font-weight: 700;">
                Welcome to the Party, ${firstName}! ⚔️
              </h2>

              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #cbd5e1;">
                You're officially on the Founder's Waitlist.
              </p>

              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #cbd5e1;">
                I'm Rob. I'm building Infinite Realms for a simple reason: <strong>I always wanted to play, but never could.</strong>
              </p>

              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #cbd5e1;">
                 Between 10-hour factory shifts and general life chaos, getting a group together was impossible. I spent years watching Actual Plays from the sidelines. So, I spent the last 3 years teaching AI how to be the perfect 5e Game Master, one that knows the rules, does the voices, and is ready to play whenever you finally get a free moment.
              </p>

              <!-- The "Loot" Box (Darker background) -->
              <div style="background-color: #0f0f23; border: 1px solid #3b0764; padding: 25px; margin: 30px 0; border-radius: 8px;">
                <h3 style="margin: 0 0 15px; font-size: 16px; color: #fbbf24; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                  ✨ Your Waitlist Perks
                </h3>
                <ul style="margin: 0; padding-left: 20px; color: #e2e8f0; line-height: 1.8; font-size: 15px;">
                  <li style="margin-bottom: 8px;">Priority access to the Beta (Coming Soon)</li>
                  <li style="margin-bottom: 8px;">Founder's Badge on your profile</li>
                  <li style="margin-bottom: 8px;">Grandfathered pricing when we launch</li>
                </ul>
              </div>

              <!-- CTA Button (Gold for high conversion) -->
              <div style="margin: 35px 0; text-align: center;">
                <a href="https://infiniterealms.app/app" style="display: inline-block; padding: 16px 36px; background: linear-gradient(135deg, #d97706 0%, #b45309 100%); color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 16px; box-shadow: 0 4px 15px rgba(217, 119, 6, 0.3); border: 1px solid #f59e0b;">
                  Check Development Status
                </a>
              </div>

              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #94a3b8;">
                I'll be sending updates as we get closer to launch. I don't spam, I only email when there's something cool to show you.
              </p>

              <p style="margin: 30px 0 0; font-size: 16px; line-height: 1.6; color: #cbd5e1;">
                See you in the dungeon,<br>
                <strong style="color: #fbbf24;">Rob</strong><br>
                <span style="font-size: 14px; color: #94a3b8;">Creator, Infinite Realms</span>
              </p>

              <!-- The P.S. (Honest & Useful) -->
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #2a2a44; font-size: 14px; color: #94a3b8; font-style: italic;">
                P.S. I'm currently creating the Pre-Made character library for the beta launch. To help me prioritize the most popular ones: <strong>What class do you usually play?</strong> Hit reply and let me know so I can make sure your favorite is ready on Day 1!
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #0f0f23; padding: 30px; text-align: center; border-top: 1px solid #1e1e32;">
              <p style="margin: 0 0 15px; font-size: 14px; color: #64748b;">
                <a href="https://x.com/printedpathways" style="color: #a78bfa; text-decoration: none; font-weight: 600;">Follow on X</a> ·
                <a href="https://infiniterealms.app" style="color: #a78bfa; text-decoration: none; font-weight: 600;">Visit Website</a>
              </p>
              <p style="margin: 0; font-size: 12px; color: #475569;">
                © 2025 Infinite Realms. Wisconsin, USA.<br>
                You received this because you signed up for the beta.
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
Welcome to the Party, ${firstName}! ⚔️

You're officially on the Founder's Waitlist.

I'm Rob. I'm building Infinite Realms for a simple reason: I always wanted to play, but never could.

Between 10-hour factory shifts and general life chaos, getting a group together was impossible. I spent years watching Actual Plays from the sidelines. So, I spent the last 3 years teaching AI how to be the perfect 5e Game Master, one that knows the rules, does the voices, and is ready to play whenever you finally get a free moment.

✨ Your Waitlist Perks:
- Priority access to the Beta (Coming Soon)
- Founder's Badge on your profile
- Grandfathered pricing when we launch

👉 Check Development Status: https://infiniterealms.app/app

I'll be sending updates as we get closer to launch. I don't spam, I only email when there's something cool to show you.

See you in the dungeon,
Rob
Creator, Infinite Realms

P.S. I'm currently creating the Pre-Made character library for the beta launch. To help me prioritize the most popular ones: What class do you usually play? Hit reply and let me know so I can make sure your favorite is ready on Day 1!

---
Follow on X: https://x.com/printedpathways
Visit Website: https://infiniterealms.app

© 2025 Infinite Realms. Wisconsin, USA.
You received this because you signed up for the beta.
  `.trim();
}
