import dotenv from "dotenv";
// Load environment variables from .env file
dotenv.config();

import express from "express";
import helmet from "helmet";
import path from "path";
import cookieParser from "cookie-parser";
import { Express, NextFunction, Request, Response } from "express";
import compression from "compression";
import mongoSanitize from "express-mongo-sanitize";
import AppError from "./utils/appError";
import errorHandler from "./utils/errorHandler";
import authRoutes from "./routes/auth.routes";
import eventRoutes from "./routes/event.routes";
import paymentRouter from "./routes/payment.routes";

// Initialize express app
const app: Express = express();

// Enable trust proxy for Heroku or other proxies
app.set("trust proxy", 1);

// Set view engine
app.set("view engine", "pug");

// Set views directory
app.set("views", path.join(__dirname, "email"));

// Middleware to make req.query mutable
app.use((req, _res, next) => {
  Object.defineProperty(req, "query", {
    value: { ...req.query },
    writable: true,
    configurable: true,
    enumerable: true,
  });
  next();
});

// Set security HTTP headers (configured for API-only)
app.use(
  helmet({
    contentSecurityPolicy: false, // Not needed for API-only server
    crossOriginEmbedderPolicy: false,
  }),
);

// Serve static files - using to test email templates
//app.use(express.static(path.join(__dirname, "public")));

// Development logging
if (process.env.NODE_ENV === "development") {
  const morgan = require("morgan");
  app.use(morgan("dev"));
}

// Parse JSON data
app.use(
  express.json({
    limit: "50mb",
    verify: (req: any, _res, buf) => (req.rawBody = buf.toString("utf-8")),
  }),
);

// Parse URL-encoded data
app.use(
  express.urlencoded({
    extended: true,
    limit: "50mb",
  }),
);

// Parse cookies
app.use(cookieParser());

// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// Compress responses
app.use(compression());

// Test route
// app.get("/", (_req: Request, res: Response) => {
//   res.status(200).render("going", {
//     firstName: "John",
//     eventName: "Community Meetup",
//     eventImage: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
//     meetingUrl: "https://meet.google.com/abc-defg-hij",
//   });
// });

// Auth routes
app.use("/api/v1/auth", authRoutes);
// Event routes
app.use("/api/v1/events", eventRoutes);
// Payment routes
app.use("/api/v1/payments", paymentRouter);

// Not found response
app.all("*", (req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Health check route
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
});

// Global error handler
app.use(errorHandler);

export default app;
