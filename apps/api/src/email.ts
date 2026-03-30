import nodemailer from "nodemailer";
import { config } from "./config.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const transporter =
  config.emailDeliveryMode === "smtp"
    ? nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        auth: config.smtpUser
          ? {
              user: config.smtpUser,
              pass: config.smtpPassword
            }
          : undefined
      })
    : null;

async function deliverMail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  if (!transporter) {
    console.info(`[email:${config.emailDeliveryMode}] to=${input.to} subject=${input.subject}`);
    return { mode: config.emailDeliveryMode };
  }

  await transporter.sendMail({
    from: config.mailFrom,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html
  });

  return { mode: config.emailDeliveryMode };
}

export async function sendInvitationEmail(input: {
  to: string;
  fullName?: string;
  tenantName: string;
  inviteUrl: string;
}) {
  const name = escapeHtml(input.fullName || input.to);
  const tenantName = escapeHtml(input.tenantName);
  return deliverMail({
    to: input.to,
    subject: `Invitation to ${input.tenantName}`,
    text: `Hello ${input.fullName || input.to},\n\nYou have been invited to ${input.tenantName} on Legal Agent.\nAccept your invitation here: ${input.inviteUrl}\n\nIf you were not expecting this, you can ignore this message.`,
    html: `<p>Hello ${name},</p><p>You have been invited to <strong>${tenantName}</strong> on Legal Agent.</p><p><a href="${escapeHtml(input.inviteUrl)}">Accept your invitation</a></p><p>If you were not expecting this, you can ignore this message.</p>`
  });
}

export async function sendPasswordResetEmail(input: {
  to: string;
  fullName?: string;
  tenantName: string;
  resetUrl: string;
}) {
  const name = escapeHtml(input.fullName || input.to);
  const tenantName = escapeHtml(input.tenantName);
  return deliverMail({
    to: input.to,
    subject: `Reset your ${input.tenantName} password`,
    text: `Hello ${input.fullName || input.to},\n\nReset your password here: ${input.resetUrl}\n\nIf you did not request this, you can ignore this message.`,
    html: `<p>Hello ${name},</p><p>Reset your password for <strong>${tenantName}</strong> here:</p><p><a href="${escapeHtml(input.resetUrl)}">Reset password</a></p><p>If you did not request this, you can ignore this message.</p>`
  });
}

export async function checkEmailHealth() {
  if (!transporter) {
    return { mode: config.emailDeliveryMode };
  }

  await transporter.verify();
  return { mode: config.emailDeliveryMode, host: config.smtpHost, port: config.smtpPort };
}
