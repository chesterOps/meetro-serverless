import express from "express";
import {
  chipin,
  getEventBalance,
  getTransactions,
  paystackWebhook,
  verifyBankAccount,
  verifyPayment,
  withdraw,
} from "../controllers/payment.controller";
import { protect } from "../middlewares/auth.middleware";

const paymentRouter = express.Router();

// Public route - verify bank account details
paymentRouter.post("/verify-account", verifyBankAccount);

// Protected route - chip in to event
paymentRouter.post("/chip-in", protect, chipin);

// Protected route - withdraw settled donations
paymentRouter.post("/withdraw", protect, withdraw);

// Protected route - get event balance
paymentRouter.get("/balance/:eventId", protect, getEventBalance);

// Protected route - get event transactions
paymentRouter.get("/transactions/:eventId", protect, getTransactions);

paymentRouter.get("/verify-payment", verifyPayment);

// Webhook - Paystack callback (no auth needed, verified via signature)
paymentRouter.post("/webhook/paystack", paystackWebhook);

export default paymentRouter;
