import { Resend } from 'resend'
import { logger } from './logger.js'

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
}): Promise<boolean> {
  const apiKey = process.env['RESEND_API_KEY']
  if (!apiKey) {
    logger.warn('RESEND_API_KEY not set — skipping email')
    return false
  }

  try {
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: 'Masters Pool <onboarding@resend.dev>',
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    })
    if (error) {
      logger.error({ error }, 'Resend send error')
      return false
    }
    logger.info({ to: opts.to, subject: opts.subject }, 'Email sent')
    return true
  } catch (err) {
    logger.error({ err }, 'Failed to send email via Resend')
    return false
  }
}
