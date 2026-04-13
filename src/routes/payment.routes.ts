import express from "express";
import {
  chipin,
  getEventBalance,
  getTransactions,
  paystackWebhook,
  updateBankDetails,
  verifyBankAccount,
  verifyPayment,
  withdraw,
} from "../controllers/payment.controller";
import { protect } from "../middlewares/auth.middleware";

const paymentRouter = express.Router();

paymentRouter.post("/verify-account", verifyBankAccount);

paymentRouter.post("/chip-in", protect, chipin);

paymentRouter.post("/withdraw", protect, withdraw);

paymentRouter.get("/balance/:eventId", protect, getEventBalance);

paymentRouter.get("/transactions/:eventId", protect, getTransactions);

paymentRouter.get("/verify-payment", verifyPayment);

paymentRouter.patch("/update-bank", protect, updateBankDetails);

paymentRouter.post("/webhook/paystack", paystackWebhook);

export default paymentRouter;
