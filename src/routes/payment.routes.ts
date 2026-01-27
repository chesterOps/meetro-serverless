import express from "express";
import {
  chipin,
  paystackWebhook,
  verifyBankAccount,
  verifyPayment,
} from "../controllers/payment.controller";
import { protect } from "../middlewares/auth.middleware";

const paymentRouter = express.Router();

// Public route - verify bank account details
paymentRouter.post("/verify-account", verifyBankAccount);

// Protected route - chip in to event
paymentRouter.post("/chip-in", protect, chipin);

paymentRouter.get("/verify-payment", verifyPayment);

// Webhook - Paystack callback (no auth needed, verified via signature)
paymentRouter.post("/webhook/paystack", paystackWebhook);

export default paymentRouter;
