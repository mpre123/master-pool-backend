import { logger } from './logger.js'
import { sendEmail } from './resend.js'

const POLL_INTERVAL_MS = 30 * 1000 // every 30 seconds

// Track which users we've already notified to avoid duplicate emails
const notifiedPending = new Set<string>()
const notifiedApproved = new Set<string>()

type DBUser = {
  id: string
  name: string
  email: string
  status: string
  is_admin: boolean
}

async function fetchUsers(): Promise<DBUser[]> {
  const supabaseUrl = process.env['SUPABASE_URL']
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!supabaseUrl || !serviceKey) return []

  const res = await fetch(`${supabaseUrl}/rest/v1/users?select=id,name,email,status,is_admin`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  })
  if (!res.ok) return []
  return res.json() as Promise<DBUser[]>
}

async function checkAndNotify() {
  try {
    const users = await fetchUsers()
    const adminUser = users.find(u => u.is_admin)
    const adminEmail = adminUser?.email

    for (const u of users) {
      // New pending user → notify admin
      if (u.status === 'pending' && !notifiedPending.has(u.id)) {
        notifiedPending.add(u.id)
        if (adminEmail) {
          await sendEmail({
            to: adminEmail,
            subject: `Masters Pool: ${u.name} just signed up`,
            html: `
              <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
                <div style="background: #006747; padding: 24px; border-radius: 12px 12px 0 0;">
                  <h1 style="color: #F2C75C; margin: 0; font-size: 22px;">⛳ New Signup</h1>
                </div>
                <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #eee;">
                  <p style="margin: 0 0 16px; font-size: 16px;"><strong>${u.name}</strong> (${u.email}) just signed up for the 2026 Masters Pool and is waiting for your approval.</p>
                  <a href="${process.env['APP_URL'] ?? 'https://your-app.replit.app'}/admin"
                     style="display: inline-block; background: #006747; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold;">
                    Approve in Admin Panel →
                  </a>
                  <p style="margin: 16px 0 0; font-size: 12px; color: #888;">Don't forget to collect $20 via Venmo @Matt-Prieskorn</p>
                </div>
              </div>
            `,
          })
        }
      }

      // Newly approved user → notify them to draft
      if (u.status === 'approved' && !u.is_admin && !notifiedApproved.has(u.id)) {
        notifiedApproved.add(u.id)
        await sendEmail({
          to: u.email,
          subject: `You're in! Draft your Masters Pool team now`,
          html: `
            <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
              <div style="background: #006747; padding: 24px; border-radius: 12px 12px 0 0;">
                <h1 style="color: #F2C75C; margin: 0; font-size: 22px;">⛳ You're Approved!</h1>
              </div>
              <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #eee;">
                <p style="margin: 0 0 8px; font-size: 16px;">Hey ${u.name},</p>
                <p style="margin: 0 0 16px; font-size: 15px; color: #444;">You've been approved for the <strong>2026 Masters Pool</strong>! You can now log in and draft your 6-player team across the 3 tiers.</p>
                <p style="margin: 0 0 20px; font-size: 14px; color: #666;">Picks lock at <strong>7:00 AM CT on Thursday, April 9</strong> — don't wait!</p>
                <a href="${process.env['APP_URL'] ?? 'https://your-app.replit.app'}/intro"
                   style="display: inline-block; background: #006747; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; font-size: 15px;">
                  Draft Your Team →
                </a>
                <p style="margin: 20px 0 0; font-size: 12px; color: #888;">Reminder: if you haven't already, send $20 to Venmo @Matt-Prieskorn with the ⛳ emoji as the note</p>
              </div>
            </div>
          `,
        })
      }
    }
  } catch (err) {
    logger.error({ err }, 'User watcher: error checking notifications')
  }
}

async function seedExistingUsers() {
  // Pre-populate Sets with all users that already exist so we don't
  // blast notifications for everyone on server boot
  const users = await fetchUsers()
  for (const u of users) {
    if (u.status === 'pending') notifiedPending.add(u.id)
    if (u.status === 'approved') notifiedApproved.add(u.id)
  }
  logger.info({ seeded: users.length }, 'User watcher: seeded existing users — only new changes will trigger emails')
}

export async function startUserWatcher() {
  const supabaseUrl = process.env['SUPABASE_URL']
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']

  if (!supabaseUrl || !serviceKey) {
    logger.warn('User watcher: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — email notifications disabled')
    return
  }

  // Seed existing users first so we don't re-notify on restart
  await seedExistingUsers()

  logger.info('User watcher: started — checking every 30s for new signups and approvals')

  // Then poll for changes going forward
  setInterval(checkAndNotify, POLL_INTERVAL_MS)
}
