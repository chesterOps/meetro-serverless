import ical from "ical-generator";

// Slugify
export function slugify(str: string) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "-");
}

// Default event image URLs
export const DEFAULT_EVENT_IMAGES = [
  "event-ph1_qj8phv.png",
  "event-ph2_jzpgki.jpg",
  "event-ph3_pib5zg.jpg",
  "event-ph4_icgikm.jpg",
  "event-ph5_ekd4bz.jpg",
  "event-ph6_s0alnz.jpg",
  "event-ph7_kpdnih.jpg",
];

// Encode to Base64
export const toBase64 = (str: string) => {
  return Buffer.from(str, "utf-8").toString("base64");
};

// Build ICS file for calendar invites
export function buildICS({
  startDate,
  endDate,
  eventID,
  title,
  description,
  location,
}: {
  startDate: Date;
  endDate: Date;
  title: string;
  eventID: string;
  description?: string;
  location?: string;
}) {
  // Build calendar
  const calendar = ical({ name: "Meetro Event", timezone: "UTC" });

  // Create event
  calendar.createEvent({
    start: startDate,
    end: endDate,
    summary: title,
    description: description,
    location: location,
    url: `https://meetro.live/event/${eventID}`,
    organizer: {
      name: "Meetro",
      email: "connect@meetro.live",
    },
  });
  return calendar.toString();
}

// Format date to readable string
export function formatDate(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  };
  return date.toLocaleDateString("en-US", options);
}

// Format time to readable string
export function formatTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const period = hours >= 12 ? "pm" : "am";
  return `${hours}:${minutes}${period}`;
}

// Calculate fee
export function calculateFee(amount: number): number {
  const feePercentage = 0.01;
  const fixedFee = 100; // NGN 100 fixed fee
  return amount * feePercentage + fixedFee;
}
