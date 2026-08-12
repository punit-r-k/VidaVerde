import nodemailer from "nodemailer";

const toBoolean = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const smtpHost = String(process.env.SMTP_HOST || "").trim();
const smtpPort = Number.parseInt(process.env.SMTP_PORT || "", 10);
const smtpUser = String(process.env.SMTP_USER || "").trim();
const smtpPass = String(process.env.SMTP_PASS || "").trim();
const orderEmailFrom = String(process.env.ORDER_EMAIL_FROM || "").trim();

const hasPartialAuth = Boolean(smtpUser || smtpPass);
const hasValidPort = Number.isFinite(smtpPort) && smtpPort > 0;

export const emailConfig =
  smtpHost &&
  hasValidPort &&
  orderEmailFrom &&
  (!hasPartialAuth || (smtpUser && smtpPass))
    ? {
        host: smtpHost,
        port: smtpPort,
        secure:
          process.env.SMTP_SECURE === undefined
            ? smtpPort === 465
            : toBoolean(process.env.SMTP_SECURE),
        auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
        from: orderEmailFrom,
        replyTo: String(process.env.ORDER_EMAIL_REPLY_TO || "").trim() || undefined,
        bcc: String(process.env.ORDER_EMAIL_BCC || "").trim() || undefined
      }
    : null;

let transport;

const getTransport = () => {
  if (!emailConfig) return null;
  if (transport) return transport;

  transport = nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    auth: emailConfig.auth,
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000
  });

  return transport;
};

export async function sendMail({
  to,
  subject,
  text,
  html,
  replyTo,
  bcc,
  attachments,
  messageId
} = {}) {
  if (!emailConfig) {
    return { ok: false, error: "Email delivery is not set up right now." };
  }

  const recipient = String(to || "").trim();
  const messageSubject = String(subject || "").trim();

  if (!recipient || !messageSubject) {
    return { ok: false, error: "Missing email recipient or subject." };
  }

  try {
    const info = await getTransport().sendMail({
      from: emailConfig.from,
      to: recipient,
      subject: messageSubject,
      text: String(text || ""),
      html: String(html || ""),
      replyTo: replyTo || emailConfig.replyTo,
      bcc: bcc || emailConfig.bcc,
      attachments: Array.isArray(attachments) ? attachments : undefined,
      messageId: String(messageId || "").trim() || undefined
    });

    if (Array.isArray(info?.rejected) && info.rejected.length > 0) {
      return {
        ok: false,
        error: `Email delivery rejected ${info.rejected.length} recipient(s).`
      };
    }

    return {
      ok: true,
      messageId: String(info?.messageId || "")
    };
  } catch (error) {
    return {
      ok: false,
      error
    };
  }
}
