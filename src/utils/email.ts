import pug from "pug";
import { convert } from "html-to-text";
import { Resend } from "resend";

// Check if RESEND_API_KEY is defined
if (!process.env.RESEND_API_KEY)
  throw new Error("RESEND_API_KEY is not defined in environment variables");

if (!process.env.FRONT_URL)
  throw new Error("FRONT_URL is not defined in environment variables");

if (!process.env.CLOUDINARY_CLOUD_NAME)
  throw new Error(
    "CLOUDINARY_CLOUD_NAME is not defined in environment variables",
  );

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY!);
export default class Email {
  options: {
    url?: string;
    from: string;
    to: string;
    siteUrl?: string;
  };

  constructor(options: { url?: string; to: string }) {
    this.options = {
      url: options.url,
      to: options.to,
      from: `"Meetro" <connect@meetro.live>`,
      siteUrl: process.env.FRONT_URL!,
    };
  }

  // Send email
  private async send(
    template: string,
    subject: string,
    options?: Record<string, any>,
    attachments?: any[],
  ) {
    // Use local path in dev/offline mode, Lambda path in production
    const templatePath = process.env.IS_OFFLINE
      ? `${__dirname}/../src/email/${template}.pug`
      : `/var/task/src/email/${template}.pug`;

    const html = pug.renderFile(templatePath, {
      url: this.options.url,
      siteUrl: this.options.siteUrl,
      subject,
      cloudinaryImagePath: `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/`,
      ...options,
    });

    // Define email options
    const mailOptions: any = {
      from: this.options.from,
      to: this.options.to,
      subject,
      html,
      text: convert(html),
    };

    // Add attachments if provided
    if (attachments) mailOptions.attachments = attachments;

    // Send email using Resend
    await resend.emails.send(mailOptions);
  }

  // Send verification email
  async sendVerification(name: string, otp: string) {
    await this.send("otp", "Verify Your Email", {
      firstName: name,
      otp,
    });
  }

  // Send reset password email
  async sendResetPassword(name: string) {
    await this.send("forgot", "Reset Your Password", {
      firstName: name,
    });
  }

  // Send welcome email
  async sendWelcome(name: string) {
    await this.send("welcome", "Welcome to Meetro!", { firstName: name });
  }

  // Send maybe confirmation email
  async sendMaybe({
    eventName,
    eventImage,
    name,
  }: {
    eventName: string;
    eventImage: string;
    name: string;
  }) {
    await this.send("maybe", `You marked "Maybe" for ${eventName}!`, {
      firstName: name,
      eventName,
      eventImage,
    });
  }

  // Send going confirmation email
  async sendGoing({
    eventName,
    eventImage,
    meetingUrl,
    dressCode,
    eventVenue,
    eventLocation,
    eventMapUrl,
    eventTime,
    eventDate,
    name,
    attachments,
  }: {
    meetingUrl?: string;
    dressCode?: string;
    eventName: string;
    eventImage: string;
    eventTime?: string;
    eventDate?: string;
    eventVenue?: string;
    eventLocation?: string;
    eventMapUrl?: string;
    name: string;
    attachments?: any[];
  }) {
    await this.send(
      "going",
      `You're going to ${eventName}!`,
      {
        firstName: name,
        eventName,
        eventImage,
        meetingUrl,
        dressCode,
        eventVenue,
        eventTime,
        eventDate,
        eventLocation,
        eventMapUrl,
      },
      attachments,
    );
  }
}
