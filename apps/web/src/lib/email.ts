import nodemailer from "nodemailer";
import { env } from "./env";

const transporte = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
});

export async function enviarEmail(msg: { para: string; assunto: string; texto: string; html: string }) {
  await transporte.sendMail({
    from: env.EMAIL_FROM,
    to: msg.para,
    subject: msg.assunto,
    text: msg.texto,
    html: msg.html,
  });
}
