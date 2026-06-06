import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('Email configuration incomplete, notifications disabled');
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  return transporter;
}

interface GamePulseFeedItem {
  id: string;
  title: string;
  content: string;
  url: string;
  game: string;
  itemKind: string;
  publishedAt: Date | null;
  createdAt: Date;
  source: {
    name: string;
    type: string;
    isOfficial: boolean;
  };
  analysis: {
    category: string | null;
    importance: string;
    confidence: number;
    summary: string | null;
    reason: string | null;
  } | null;
}

export async function sendFeedItemEmail(item: GamePulseFeedItem): Promise<boolean> {
  const mailer = getTransporter();

  if (!mailer || !process.env.NOTIFY_EMAIL) {
    return false;
  }

  const importanceLabel: Record<string, string> = {
    low: '[LOW]',
    medium: '[MEDIUM]',
    high: '[HIGH]',
    urgent: '[URGENT]'
  };
  const importance = item.analysis?.importance || 'low';

  try {
    await mailer.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.NOTIFY_EMAIL,
      subject: `${importanceLabel[importance] || '[INFO]'} Game Pulse: ${item.game} - ${item.title.slice(0, 50)}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #f4f7fb; }
            .container { max-width: 640px; margin: 0 auto; padding: 24px; }
            .panel { background: #171b24; border: 1px solid #2a3140; border-radius: 12px; padding: 20px; }
            .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #22324a; color: #8cc8ff; font-size: 12px; margin-right: 6px; }
            .muted { color: #9aa4b2; font-size: 14px; }
            .button { display: inline-block; margin-top: 18px; background: #6d7cff; color: #fff; padding: 10px 16px; border-radius: 8px; text-decoration: none; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="panel">
              <p>
                <span class="badge">${item.game}</span>
                <span class="badge">${item.source.name}</span>
                <span class="badge">${importance}</span>
              </p>
              <h2>${escapeHtml(item.title)}</h2>
              ${item.analysis?.summary ? `<p>${escapeHtml(item.analysis.summary)}</p>` : ''}
              ${item.analysis?.reason ? `<p class="muted">${escapeHtml(item.analysis.reason)}</p>` : ''}
              <p class="muted">来源类型：${item.source.type} · 分类：${item.analysis?.category || item.itemKind}</p>
              <a class="button" href="${item.url}">查看原文</a>
            </div>
          </div>
        </body>
        </html>
      `
    });

    return true;
  } catch (error) {
    console.error('Failed to send Game Pulse email:', error);
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
