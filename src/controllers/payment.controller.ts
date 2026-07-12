import crypto from "crypto";
import User from "../models/user.model";
import Transaction, { ITransaction } from "../models/transaction.model";
import Event from "../models/event.model";
import Response from "../models/response.model";
import AppError from "../utils/appError";
import catchAsync from "../utils/catchAsync";
import mongoose, { isValidObjectId } from "mongoose";
import { paystack } from "../paystack/paystackSettlementPoller";
import { calculateFee } from "../utils/helpers";

// Withdrawal configuration constants
const MIN_WITHDRAWAL_AMOUNT = 1000; // Minimum ₦1,000
const WITHDRAWAL_RATE_LIMIT_HOURS = 1; // 1 hour between withdrawals

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

export const updateUserBankDetails = catchAsync(async (req, res, next) => {
  const userID = res.locals.user._id;
  const user = await User.findById(userID);
  if (!user) {
    return next(new AppError("User not found", 404));
  }
  const { accountNumber, bankName, accountName, bankCode, eventFeesPaidBy } =
    req.body;

  if (accountName && bankCode && accountNumber && bankName) {
    user.bankDetails = {
      accountNumber,
      bankName,
      bankCode,
      accountName,
    };
  }

  if (eventFeesPaidBy) {
    user.preferences = {
      ...user.preferences,
      eventFeesPaidBy,
    };
  }

  await user.save();

  res.status(200).json({
    status: "success",
    data: {
      bankDetails: {
        accountNumber: user.bankDetails?.accountNumber || "",
        bankName: user.bankDetails?.bankName || "",
        bankCode: user.bankDetails?.bankCode || "",
        accountName: user.bankDetails?.accountName || "",
      },
      preferences: user.preferences,
    },
    message: "Bank details updated successfully",
  });
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

  // Create transaction
  const transaction = await Transaction.create({
    event: eventId,
    userId: user._id,
    type: "chip-in",
    amount,
    paymentReference,
    gateway: "paystack",
  });

  // Check if transaction was created successfully
  if (!transaction) {
    return next(new AppError("Failed to create transaction", 500));
  }
  try {
    let totalAmountKobo;
    if (event.feeResponsibility === "host") {
      totalAmountKobo = Math.round(amount * 100);
    } else {
      totalAmountKobo = Math.round((Number(amount) + transaction.fee!) * 100);
    }
    // Create paystack payment link
    const response = await paystack.post("/transaction/initialize", {
      email,
      amount: totalAmountKobo, // Amount in kobo
      reference: paymentReference,
      callback_url: `${process.env.FRONT_URL}/verify-payment`,
      metadata: {
        eventId: eventId,
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

  if (!eventId) return next(new AppError("Event ID is required", 400));

  const requestedPayout = Number(amount);

  if (!Number.isFinite(requestedPayout) || requestedPayout <= 0) {
    return next(new AppError("Withdrawal amount must be positive", 400));
  }

  if (requestedPayout < MIN_WITHDRAWAL_AMOUNT) {
    return next(
      new AppError(
        `Minimum withdrawal amount is ₦${MIN_WITHDRAWAL_AMOUNT.toLocaleString()}`,
        400,
      ),
    );
  }

  // feeResponsibility determines whether the platform fee comes out of
  // this withdrawal (host bears it) or was already collected from guests
  // at chip-in time (guests bear it, so the host gets the full amount).
  const event = await Event.findById(eventId).select(
    "host chipInDetails title feeResponsibility",
  );

  if (!event) return next(new AppError("Event not found", 404));

  if (event.host._id.toString() !== user._id.toString()) {
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

  const rateLimitTime = new Date(
    Date.now() - WITHDRAWAL_RATE_LIMIT_HOURS * 60 * 60 * 1000,
  );
  const recentWithdrawal = await Transaction.findOne({
    event: eventId,
    type: "withdrawal",
    createdAt: { $gte: rateLimitTime },
  }).sort({ createdAt: -1 });

  // if (recentWithdrawal) {
  //   const timeSinceLastWithdrawal =
  //     Date.now() - recentWithdrawal.createdAt.getTime();
  //   const minutesRemaining = Math.ceil(
  //     (WITHDRAWAL_RATE_LIMIT_HOURS * 60 * 60 * 1000 - timeSinceLastWithdrawal) /
  //       60000,
  //   );
  //   return next(
  //     new AppError(
  //       `Please wait ${minutesRemaining} minutes before making another withdrawal`,
  //       429,
  //     ),
  //   );
  // }

  // "guests": fee already collected on top at checkout -> full amount to host.
  // "host" (default): fee never collected upfront -> deducted here, as before.
  const hostBearsFee = event.feeResponsibility !== "guests";
  const withdrawalFee = hostBearsFee ? calculateFee(requestedPayout) : 0;
  const netPayout = requestedPayout - withdrawalFee;

  if (netPayout <= 0) {
    return next(
      new AppError(
        `Withdrawal amount is too low after fees. Minimum amount to cover fees is ₦${Math.ceil(withdrawalFee).toLocaleString()}`,
        400,
      ),
    );
  }

  const netPayoutKobo = Math.round(netPayout * 100);
  const payoutReference = `PAYOUT_${Date.now()}_${crypto
    .randomBytes(8)
    .toString("hex")}`;

  const currentBalance = await Transaction.getEventBalance(eventId);

  if (!currentBalance || currentBalance <= 0) {
    return next(new AppError("No available balance for withdrawal", 400));
  }

  if (requestedPayout > currentBalance) {
    return next(
      new AppError(
        `Requested amount exceeds available balance. Available: ₦${currentBalance.toFixed(2)}`,
        400,
      ),
    );
  }

  let transferResponse;
  try {
    transferResponse = await paystack.post("/transfer", {
      source: "balance",
      amount: netPayoutKobo,
      recipient: event.chipInDetails.bankDetails.recipientCode,
      reason: `Event payout for ${event.title}`,
      reference: payoutReference,
    });
  } catch (error: any) {
    return next(
      new AppError(
        error.response?.data?.message ||
          error.message ||
          "Paystack transfer failed",
        500,
      ),
    );
  }

  if (!transferResponse.data?.status) {
    return next(new AppError("Failed to initiate payout transfer", 500));
  }

  const transferCode: string =
    transferResponse.data?.data?.transfer_code ||
    transferResponse.data?.data?.reference ||
    payoutReference;
  const transferStatus: string =
    transferResponse.data?.data?.status || "unknown";

  const acceptedTransferStatuses = [
    "success",
    "completed",
    "pending",
    "processing",
    "queued",
  ];

  if (!acceptedTransferStatuses.includes(transferStatus)) {
    return next(
      new AppError(
        `Transfer could not be initiated at the payment gateway. ${transferStatus} ${transferCode}`,
        400,
      ),
    );
  }

  // Matches ITransaction["status"]: "pending" | "completed" | "failed" | "refunded"
  const withdrawalStatus: ITransaction["status"] =
    transferStatus === "success" || transferStatus === "completed"
      ? "completed"
      : "pending";

  const session = await mongoose.startSession();
  session.startTransaction();

  let transaction: mongoose.HydratedDocument<ITransaction> | undefined;

  try {
    const finalBalance = await Transaction.getEventBalance(eventId);

    if (requestedPayout > finalBalance) {
      throw new AppError(
        "Balance changed during withdrawal. Please try again.",
        409,
      );
    }

    const createdDocs = await Transaction.create(
      [
        {
          event: event._id,
          userId: user._id,
          type: "withdrawal",
          amount: requestedPayout,
          fee: withdrawalFee,
          currency: "NGN",
          status: withdrawalStatus,
          settledAt: withdrawalStatus === "completed" ? new Date() : undefined,
          reference: payoutReference,
          transferCode,
          gateway: "paystack",
          metadata: {
            gatewayResponse: transferResponse.data?.data,
          },
          bankDetails: {
            accountName: event.chipInDetails.bankDetails.accountName,
            accountNumber: event.chipInDetails.bankDetails.accountNumber,
            bankName: event.chipInDetails.bankDetails.bankName,
            bankCode: event.chipInDetails.bankDetails.bankCode,
          },
        },
      ],
      { session },
    );

    transaction =
      createdDocs[0] as unknown as mongoose.HydratedDocument<ITransaction>;

    // Commit is the LAST statement in this try block. Once it succeeds the
    // session can't be aborted, so nothing after it (e.g. the balance
    // lookup below) may live inside this try/catch.
    await session.commitTransaction();
  } catch (error: any) {
    // Only reaches here for failures before commit succeeded, so the
    // session is guaranteed still abortable.
    await session.abortTransaction();

    if (error instanceof AppError) {
      return next(error);
    }

    return next(
      new AppError(
        error.message || "Withdrawal failed. Please try again.",
        error.statusCode || 500,
      ),
    );
  } finally {
    session.endSession();
  }

  // Runs only after a successful commit. The withdrawal record is already
  // persisted regardless of what happens in this block.
  const newBalance =
    withdrawalStatus === "completed"
      ? await Transaction.getEventBalance(eventId)
      : null;

  const statusCode = withdrawalStatus === "completed" ? 200 : 202;

  const message =
    withdrawalStatus === "completed"
      ? "Payout completed successfully"
      : "Payout initiated successfully and is pending confirmation";

  res.status(statusCode).json({
    status: "success",
    data: {
      transaction,
      newBalance,
      fee: withdrawalFee,
      feeResponsibility: event.feeResponsibility,
    },
    message,
  });
});

export const getTransactions = catchAsync(async (req, res, next) => {
  const user = res.locals.user;
  const { eventId } = req.params;

  if (!eventId) {
    return next(new AppError("Event ID or slug is required", 400));
  }

  // Check if eventId is slug or ID
  const isSlug = !isValidObjectId(eventId);

  // Find event by ID or slug
  const event = isSlug
    ? await Event.findOne({ slug: eventId }).select("host")
    : await Event.findById(eventId).select("host");

  if (!event) return next(new AppError("Event not found", 404));

  if (event.host._id.toString() !== user._id.toString()) {
    return next(
      new AppError(
        "You do not have permission to view transactions for this event.",
        403,
      ),
    );
  }

  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
  const skip = (page - 1) * limit;

  // Get search and sort parameters
  const search = (req.query.search as string)?.trim().toLowerCase() || "";
  const sortBy = (req.query.sortBy as string) || "date"; // date, amount
  const sortOrder = (req.query.sortOrder as string) || "desc"; // asc, desc

  // Fetch all transactions from the unified model
  const transactions = await Transaction.find({ event: event._id })
    .populate({ path: "userId", select: "firstName lastName email" })
    .sort({ createdAt: -1, _id: -1 })
    .lean();

  let combined = transactions.map((transaction: any) => {
    if (transaction.type === "chip-in") {
      return {
        user: transaction.userId
          ? `${transaction.userId.firstName} ${transaction.userId.lastName}`
          : transaction.userId?.email || "Unknown User",
        amount: transaction.amount,
        date: transaction.createdAt,
        type: "credit",
        paymentFor: "chip-in",
        status:
          transaction.status === "completed"
            ? "successful"
            : transaction.status,
      };
    } else {
      return {
        bank: transaction.bankDetails?.bankName || "N/A",
        accountNumber: transaction.bankDetails?.accountNumber
          ? `xxxxxx${transaction.bankDetails.accountNumber.slice(-4)}`
          : "N/A",
        amount: transaction.amount,
        date: transaction.createdAt,
        type: "withdrawal",
        status:
          transaction.status === "completed"
            ? "successful"
            : transaction.status,
      };
    }
  });

  // Search functionality
  if (search) {
    combined = combined.filter((transaction: any) => {
      const searchLower = search.toLowerCase();

      // Search in user name (for credit transactions)
      if (transaction.type === "credit" && transaction.user) {
        if (transaction.user.toLowerCase().includes(searchLower)) return true;
      }

      return false;
    });
  }

  // Sort functionality
  combined.sort((a, b) => {
    let comparison = 0;

    if (sortBy === "amount") {
      comparison = a.amount - b.amount;
    } else {
      // Default sort by date
      const aTime = a.date ? new Date(a.date).getTime() : 0;
      const bTime = b.date ? new Date(b.date).getTime() : 0;
      comparison = aTime - bTime;
    }

    return sortOrder === "asc" ? comparison : -comparison;
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
        const existingTransaction = await Transaction.findOne({
          paymentReference: reference,
        });

        let transaction;

        if (existingTransaction && existingTransaction.status === "completed") {
          // Already processed by webhook, return existing data
          transaction = await Transaction.findOne({
            paymentReference: reference,
          }).populate({
            path: "event",
            select: "chipInDetails title image slug host",
          });

          if (!transaction) return next(new AppError("Chip-in not found", 404));

          data = handleFormatData(transaction);
          break;
        }

        // Find and update transaction
        transaction = await Transaction.findOneAndUpdate(
          {
            paymentReference: reference,
          },
          {
            status: "completed",
            metadata: {
              transactionId: reference?.toString(),
              gatewayResponse: paymentData.gateway_response,
            },
          },
          { new: true },
        ).populate({
          path: "event",
          select: "chipInDetails title image slug host",
        });
        // Check if transaction exists
        if (!transaction) return next(new AppError("Chip-in not found", 404));

        // Create or update response for the user with "going" status
        await Response.findOneAndUpdate(
          {
            event: transaction.event._id,
            user: transaction.userId,
          },
          {
            status: "going",
            amountPaid: transaction.amount,
          },
          { upsert: true, new: true },
        );

        // Prepare response data
        data = handleFormatData(transaction);
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
  const payload = req.body;
  const hash = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY!)
    .update(JSON.stringify(payload))
    .digest("hex");
  const signature = req.headers["x-paystack-signature"];

  if (hash !== signature) {
    return res.sendStatus(400);
  }

  const eventType = payload.event;
  const eventData = payload.data;

  try {
    switch (eventType) {
      case "charge.success": {
        const reference = eventData.reference;

        // Verify transaction with Paystack
        const response = await paystack.get(`/transaction/verify/${reference}`);
        const verifiedData = response.data.data;

        if (verifiedData.status !== "success") {
          return res.sendStatus(400);
        }

        const paymentType = verifiedData.metadata.type;

        switch (paymentType) {
          case "chipin": {
            // Check if already processed (idempotency)
            const existingTransaction = await Transaction.findOne({
              paymentReference: reference,
            });
            if (
              existingTransaction &&
              existingTransaction.status === "completed"
            ) {
              return res.sendStatus(200); // Already processed
            }

            const completedTransaction = await Transaction.findOneAndUpdate(
              { paymentReference: reference },
              {
                status: "completed",
                metadata: {
                  transactionId: reference?.toString(),
                  gatewayResponse: verifiedData.gateway_response,
                },
              },
              { new: true },
            );

            // Create or update response for the user with "going" status
            if (completedTransaction) {
              await Response.findOneAndUpdate(
                {
                  event: completedTransaction.event,
                  user: completedTransaction.userId,
                },
                {
                  status: "going",
                  amountPaid: completedTransaction.amount,
                },
                { upsert: true, new: true },
              );
            }
            break;
          }
          case "ticket":
            // Handle ticket payment update here
            break;
          default:
            return res.sendStatus(400);
        }
        break;
      }

      // Fires once a transfer (withdrawal) actually settles at Paystack.
      // This - not the initial /transfer response in the withdraw handler -
      // is the source of truth for completion, since "pending"/"processing"/
      // "queued" there only mean the transfer was accepted, not settled.
      case "transfer.success": {
        const transferReference = eventData.reference;
        const transferCode = eventData.transfer_code;

        const existingTransaction = await Transaction.findOne({
          type: "withdrawal",
          $or: [{ reference: transferReference }, { transferCode }],
        });

        if (!existingTransaction) {
          console.error(
            `transfer.success: no matching withdrawal for reference=${transferReference} transferCode=${transferCode}`,
          );
          return res.sendStatus(200);
        }

        if (existingTransaction.status === "completed") {
          return res.sendStatus(200); // Already processed
        }

        existingTransaction.status = "completed";
        existingTransaction.settledAt = new Date();
        existingTransaction.metadata = {
          ...existingTransaction.metadata,
          gatewayResponse: eventData,
        };
        await existingTransaction.save();
        break;
      }

      // Transfer was rejected or reversed. Mark it terminal so it doesn't
      // sit as "pending" forever and so it stops being counted against
      // the event's available balance.
      case "transfer.failed":
      case "transfer.reversed": {
        const transferReference = eventData.reference;
        const transferCode = eventData.transfer_code;

        const existingTransaction = await Transaction.findOne({
          type: "withdrawal",
          $or: [{ reference: transferReference }, { transferCode }],
        });

        if (!existingTransaction) {
          console.error(
            `${eventType}: no matching withdrawal for reference=${transferReference} transferCode=${transferCode}`,
          );
          return res.sendStatus(200);
        }

        if (
          existingTransaction.status === "completed" ||
          existingTransaction.status === "failed"
        ) {
          return res.sendStatus(200); // Already terminal
        }

        // Not "settled" in the financial sense (no money moved), so
        // settledAt is intentionally left unset here.
        existingTransaction.status = "failed";
        existingTransaction.metadata = {
          ...existingTransaction.metadata,
          gatewayResponse: eventData,
        };
        await existingTransaction.save();
        break;
      }

      default:
        return res.sendStatus(400);
    }
  } catch (error: any) {
    console.error("Webhook processing error:", error.message);
    return res.sendStatus(500);
  }

  res.sendStatus(200);
});

export const getEventBalance = catchAsync(async (req, res, next) => {
  const user = res.locals.user;
  const { eventId } = req.params;

  if (!eventId) {
    return next(new AppError("Event ID or slug is required", 400));
  }

  // Check if eventId is slug or ID
  const isSlug = !isValidObjectId(eventId);
  // Find event by ID or slug
  const event = isSlug
    ? await Event.findOne({ slug: eventId })
    : await Event.findById(eventId);
  if (!event) return next(new AppError("Event not found", 404));

  if (event.host._id.toString() !== user._id.toString()) {
    return next(
      new AppError(
        "You do not have permission to view the balance for this event.",
        403,
      ),
    );
  }

  const balance = await Transaction.getEventBalance(event._id);

  res.status(200).json({
    status: "success",
    data: {
      eventId: event._id,
      hostId: event.host._id,
      bankDetails: event.chipInDetails?.bankDetails || null,
      balance,
    },
    message: "Event balance retrieved successfully",
  });
});
