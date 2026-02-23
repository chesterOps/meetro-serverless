import { paystack } from "../paystack/paystackSettlementPoller";
import crypto from "crypto";
import Donation from "../models/donation.model";
import Event from "../models/event.model";
import Withdrawal from "../models/withdrawal.model";
import AppError from "../utils/appError";
import catchAsync from "../utils/catchAsync";

function handleFormatData(donation: any) {
  const data = { ...donation.toObject() };
  data.event = {
    title: data.event.title,
    slug: data.event.slug,
    image: data.event.image.url,
    host: {
      name: data.event.host.name,
      email: data.event.host.email,
    },
  };
  if ((donation.event as any).host.photo)
    data.event.host.photo = (donation.event as any).host.photo;
  return data;
}

export const verifyBankAccount = catchAsync(async (req, res, next) => {
  // Get account number and bank code from request body
  const { accountNumber, bankCode } = req.body;

  // Check if account number and bank code are provided
  if (!accountNumber || !bankCode) {
    return next(new AppError("Account number and bank code are required", 400));
  }

  try {
    // Call Paystack API to verify bank account
    const response = await paystack.get("/bank/resolve", {
      params: {
        account_number: accountNumber,
        bank_code: bankCode,
      },
    });

    // Check if verification was successful
    if (!response.data.status)
      return next(new AppError("Bank account verification failed", 400));

    // Send back the account name
    res.status(200).json({
      status: "success",
      data: {
        accountName: response.data.data.account_name,
        accountNumber: response.data.data.account_number,
      },
      message: "Bank account verified successfully",
    });
  } catch (error: any) {
    return next(
      new AppError(error.response?.data?.message || error.message, 500),
    );
  }
});

export const chipin = catchAsync(async (req, res, next) => {
  // Get current user email
  const user = res.locals.user;
  const email = user.email;
  // Get donation details from request body
  const { amount, eventId } = req.body;

  // Get event and check if it allows donations
  const event = await Event.findOne({ _id: eventId });
  // Check if event exists and allows donations
  if (!event) return next(new AppError("Event not found", 404));

  // Check if event is private and has chip-in details
  if (!event.isPrivate || !event.chipInDetails) {
    return next(new AppError("This event does not accept donations", 400));
  }

  // Create payment reference
  const paymentReference = `CHIP-IN_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;

  // Ensure amount is positive
  if (amount <= 0) {
    return next(new AppError("Amount must be positive", 400));
  }

  // Create donation
  const donation = await Donation.create({
    event: eventId,
    userId: user._id,
    amount,
    paymentReference,
  });

  // Check if donation was created successfully
  if (!donation) {
    return next(new AppError("Failed to create donation", 500));
  }
  try {
    // Create paystack payment link
    const totalAmountKobo = Math.round((Number(amount) + donation.fee) * 100);
    const response = await paystack.post("/transaction/initialize", {
      email,
      amount: totalAmountKobo, // Amount in kobo
      reference: paymentReference,
      callback_url: `${process.env.FRONT_URL}/verify-payment`,
      metadata: {
        eventId: eventId,
        transaction_fee: donation.fee,
        originalAmount: Number(amount),
        type: "chipin",
      },
    });

    // Check if payment link was created successfully
    if (response.data.status !== true) {
      return next(new AppError("Failed to initialize payment", 500));
    }

    // Send response with payment link
    res.status(201).json({
      status: "success",
      data: {
        paymentLink: response.data.data.authorization_url,
      },
      message: "Payment link created successfully",
    });
  } catch (error: any) {
    return next(
      new AppError(error.response?.data?.message || error.message, 500),
    );
  }
});

export const withdraw = catchAsync(async (req, res, next) => {
  const user = res.locals.user;
  const { eventId, amount } = req.body;

  if (!eventId) {
    return next(new AppError("Event ID is required", 400));
  }

  if (!amount || Number(amount) <= 0) {
    return next(new AppError("Withdrawal amount must be positive", 400));
  }

  const event = await Event.findById(eventId).select(
    "host chipInDetails title balance",
  );

  if (!event) return next(new AppError("Event not found", 404));

  if (event.host.toString() !== user._id.toString()) {
    return next(
      new AppError(
        "You do not have permission to withdraw donations for this event.",
        403,
      ),
    );
  }

  if (!event.chipInDetails?.bankDetails?.recipientCode) {
    return next(
      new AppError(
        "Event bank details are incomplete. Please update event bank details.",
        400,
      ),
    );
  }

  const requestedPayout = Number(amount);
  const requestedPayoutKobo = Math.round(requestedPayout * 100);

  if (!Number.isFinite(requestedPayout) || requestedPayout <= 0) {
    return next(new AppError("Withdrawal amount must be positive", 400));
  }

  if (!event.balance || event.balance <= 0) {
    return next(new AppError("No available balance for withdrawal", 400));
  }

  if (requestedPayout > event.balance) {
    return next(
      new AppError(
        `Requested amount exceeds available balance. Available: ${event.balance.toFixed(2)}`,
        400,
      ),
    );
  }

  const reservedEvent = await Event.findOneAndUpdate(
    { _id: event._id, balance: { $gte: requestedPayout } },
    { $inc: { balance: -requestedPayout } },
    { new: true },
  );

  if (!reservedEvent) {
    return next(new AppError("Insufficient balance for withdrawal", 400));
  }

  const payoutReference = `PAYOUT_${Date.now()}_${crypto
    .randomBytes(8)
    .toString("hex")}`;

  let transferResponse;
  try {
    transferResponse = await paystack.post("/transfer", {
      source: "balance",
      amount: requestedPayoutKobo,
      recipient: event.chipInDetails.bankDetails.recipientCode,
      reason: `Event payout for ${event.title}`,
      reference: payoutReference,
    });
  } catch (error: any) {
    await Event.updateOne(
      { _id: event._id },
      { $inc: { balance: requestedPayout } },
    );
    return next(
      new AppError(error.response?.data?.message || error.message, 500),
    );
  }

  if (!transferResponse.data?.status) {
    return next(new AppError("Failed to initiate payout transfer", 500));
  }

  const transferCode =
    transferResponse.data?.data?.transfer_code ||
    transferResponse.data?.data?.reference ||
    payoutReference;
  const transferStatus = transferResponse.data?.data?.status;
  const payoutStatus = transferStatus === "success" ? "paid" : "pending";

  await Withdrawal.create({
    event: event._id,
    userId: user._id,
    amount: requestedPayout,
    currency: "NGN",
    status: payoutStatus,
    reference: payoutReference,
    transferCode,
    gateway: "paystack",
  });

  res.status(200).json({
    status: "success",
    data: {
      eventId: event._id,
      payoutAmount: requestedPayout,
      payoutReference: transferCode,
      balance: reservedEvent.balance,
    },
    message: "Payout initiated successfully",
  });
});

export const getTransactions = catchAsync(async (req, res, next) => {
  const user = res.locals.user;
  const { eventId } = req.query;

  if (!eventId) {
    return next(new AppError("Event ID is required", 400));
  }

  const event = await Event.findById(eventId).select("host");

  if (!event) return next(new AppError("Event not found", 404));

  if (event.host.toString() !== user._id.toString()) {
    return next(
      new AppError(
        "You do not have permission to view transactions for this event.",
        403,
      ),
    );
  }

  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const skip = (page - 1) * limit;

  const [chipIns, withdrawals] = await Promise.all([
    Donation.find({ event: event._id }).sort({ createdAt: -1, _id: -1 }).lean(),
    Withdrawal.find({ event: event._id })
      .sort({ createdAt: -1, _id: -1 })
      .lean(),
  ]);

  const combined = [
    ...chipIns.map((donation: any) => ({
      type: "credit",
      date: donation.createdAt,
      donation,
    })),
    ...withdrawals.map((withdrawal: any) => ({
      type: "withdrawal",
      date: withdrawal.createdAt,
      withdrawal,
    })),
  ];

  combined.sort((a, b) => {
    const aTime = a.date ? new Date(a.date).getTime() : 0;
    const bTime = b.date ? new Date(b.date).getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return 0;
  });

  const total = combined.length;
  const paged = combined.slice(skip, skip + limit);

  res.status(200).json({
    status: "success",
    data: {
      transactions: paged,
    },
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});

export const verifyPayment = catchAsync(async (req, res, next) => {
  //  Get reference from query parameters
  const { reference } = req.query;

  // Check if reference is provided
  if (!reference) {
    return next(new AppError("Payment reference is required", 400));
  }

  // Verify payment with Paystack
  try {
    const response = await paystack.get(`/transaction/verify/${reference}`);

    // Get payment data from response
    const paymentData = response.data.data;

    // Check if payment was successful
    if (paymentData.status !== "success") {
      return next(new AppError("Payment not successful", 400));
    }

    // Get payment type
    const paymentType = paymentData.metadata.type;

    // Validate payment amount matches expected amount
    const expectedAmount = Math.round(
      (paymentData.metadata.originalAmount +
        paymentData.metadata.transaction_fee) *
        100,
    );
    if (paymentData.amount !== expectedAmount) {
      return next(new AppError("Payment amount mismatch", 400));
    }

    let data: any;

    // Handle based on payment type
    switch (paymentType) {
      case "chipin":
        // Check if already processed (idempotency)
        const existingDonation = await Donation.findOne({
          paymentReference: reference,
        });

        let donation;

        if (existingDonation && existingDonation.status === "completed") {
          // Already processed by webhook, return existing data
          donation = await Donation.findOne({
            paymentReference: reference,
          }).populate({
            path: "event",
            select: "chipInDetails title image slug host",
          });

          if (!donation) return next(new AppError("Chip-in not found", 404));

          data = handleFormatData(donation);
          break;
        }

        // Find and update donation
        donation = await Donation.findOneAndUpdate(
          {
            paymentReference: reference,
          },
          {
            status: "completed",
            metadata: {
              transactionId: reference?.toString(),
              gateway: "paystack",
              gatewayResponse: paymentData.gateway_response,
            },
          },
          { new: true },
        ).populate({
          path: "event",
          select: "chipInDetails title image slug host",
        });
        // Check if donation exists
        if (!donation) return next(new AppError("Chip-in not found", 404));

        // Prepare response data
        data = handleFormatData(donation);
        break;
      case "ticket":
        break;
      default:
        return next(new AppError("Invalid payment type", 400));
    }
    // Send success response
    res.status(200).json({
      status: "success",
      data,
      paymentType,
      message: "Payment verified successfully",
    });
  } catch (error: any) {
    return next(
      new AppError(error.response?.data?.message || error.message, 500),
    );
  }
});

export const paystackWebhook = catchAsync(async (req, res, _next) => {
  // Handle Paystack webhook events here
  const payload = req.body;
  const hash = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY!)
    .update(JSON.stringify(payload))
    .digest("hex");

  const signature = req.headers["x-paystack-signature"];

  // Verify the signature
  if (hash !== signature || payload.event !== "charge.success") {
    return res.sendStatus(400);
  }

  const paymentData = payload.data;
  const reference = paymentData.reference;

  // Verify transaction with Paystack
  try {
    const response = await paystack.get(`/transaction/verify/${reference}`);

    // Verify payment was successful
    const verifiedData = response.data.data;
    if (verifiedData.status !== "success") {
      return res.sendStatus(400);
    }

    // Check payment type from metadata
    const paymentType = verifiedData.metadata.type;

    switch (paymentType) {
      case "chipin":
        // Check if already processed (idempotency)
        const existingDonation = await Donation.findOne({
          paymentReference: reference,
        });
        if (existingDonation && existingDonation.status === "completed") {
          return res.sendStatus(200); // Already processed
        }

        // Update donation status
        await Donation.findOneAndUpdate(
          { paymentReference: reference },
          {
            status: "completed",
            metadata: {
              transactionId: reference?.toString(),
              gateway: "paystack",
              gatewayResponse: verifiedData.gateway_response,
            },
          },
        );
        break;
      case "ticket":
        // Handle ticket payment update here
        break;
      default:
        return res.sendStatus(400);
    }
  } catch (error: any) {
    console.error("Webhook processing error:", error.message);
    return res.sendStatus(500);
  }

  res.sendStatus(200);
});
