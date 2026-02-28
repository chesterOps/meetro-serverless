import mongoose from "mongoose";
import { calculateFee } from "../utils/helpers";

// Transaction interface
export interface ITransaction {
  event: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  type: "chip-in" | "withdrawal";
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed" | "refunded";
  reference?: string;
  paymentReference?: string;
  transferCode?: string;
  gateway: string;
  fee?: number;
  metadata?: {
    transactionId?: string;
    gatewayResponse?: any;
  };
  bankDetails?: {
    accountName: string;
    accountNumber: string;
    bankName: string;
    bankCode: string;
  };
  settledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Transaction methods interface
interface ITransactionMethods {
  isRefundable(): boolean;
}

// Transaction static methods interface
interface ITransactionStatics {
  getEventBalance(eventId: mongoose.Types.ObjectId): Promise<number>;
  getTotalChipIns(eventId: mongoose.Types.ObjectId): Promise<{
    _id: mongoose.Types.ObjectId;
    totalAmount: number;
    count: number;
  } | null>;
}

// Transaction model type
type TransactionModel = mongoose.Model<ITransaction, {}, ITransactionMethods> &
  ITransactionStatics;

// Transaction schema
const transactionSchema = new mongoose.Schema<
  ITransaction,
  TransactionModel,
  ITransactionMethods
>(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: [true, "Transaction must belong to an event"],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Transaction must belong to a user"],
      index: true,
    },
    type: {
      type: String,
      enum: {
        values: ["chip-in", "withdrawal"],
        message: "Transaction type must be either chip-in or withdrawal",
      },
      required: [true, "Transaction type is required"],
      index: true,
    },
    amount: {
      type: Number,
      required: [true, "Transaction amount is required"],
      min: [0, "Transaction amount must be positive"],
    },
    currency: {
      type: String,
      default: "NGN",
      uppercase: true,
      enum: {
        values: ["NGN"],
        message: "Currency must be NGN",
      },
    },
    fee: {
      type: Number,
      validate: {
        validator: function (value: number) {
          return value >= 0;
        },
        message: "Transaction fee must be a positive number",
      },
    },
    settledAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: {
        values: ["pending", "completed", "failed", "refunded"],
        message: "Invalid transaction status",
      },
      default: "pending",
      index: true,
    },
    reference: {
      type: String,
      trim: true,
      sparse: true,
    },
    paymentReference: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    transferCode: {
      type: String,
      trim: true,
    },
    gateway: {
      type: String,
      default: "paystack",
    },
    metadata: {
      transactionId: String,
      gatewayResponse: mongoose.Schema.Types.Mixed,
    },
    bankDetails: {
      type: {
        accountName: {
          type: String,
          required: [
            function (this: ITransaction) {
              return this.type === "withdrawal";
            },
            "Account name is required for withdrawals",
          ],
        },
        accountNumber: {
          type: String,
          required: [
            function (this: ITransaction) {
              return this.type === "withdrawal";
            },
            "Account number is required for withdrawals",
          ],
        },
        bankName: {
          type: String,
          required: [
            function (this: ITransaction) {
              return this.type === "withdrawal";
            },
            "Bank name is required for withdrawals",
          ],
        },
        bankCode: {
          type: String,
          required: [
            function (this: ITransaction) {
              return this.type === "withdrawal";
            },
            "Bank code is required for withdrawals",
          ],
        },
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes for efficient queries
transactionSchema.index({ event: 1, createdAt: -1 });
transactionSchema.index({ event: 1, type: 1, status: 1 });
transactionSchema.index({ userId: 1, createdAt: -1 });

// Pre-save middleware to calculate fee for chip-ins
transactionSchema.pre("save", function () {
  if (this.isNew && this.type === "chip-in" && !this.fee) {
    this.fee = calculateFee(this.amount);
  }
});

// Instance method to check if refundable
transactionSchema.methods.isRefundable = function (): boolean {
  if (this.type !== "chip-in") return false;
  if (this.status !== "completed") return false;

  const refundWindow = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
  const timeSinceTransaction = Date.now() - this.createdAt.getTime();

  return timeSinceTransaction < refundWindow;
};

// Static method to calculate event balance from transactions
transactionSchema.statics.getEventBalance = async function (
  eventId: mongoose.Types.ObjectId,
): Promise<number> {
  const result = await this.aggregate([
    {
      $match: {
        event: eventId,
        status: "completed",
      },
    },
    {
      $group: {
        _id: "$type",
        total: { $sum: "$amount" },
      },
    },
  ]);

  let chipIns = 0;
  let withdrawals = 0;

  result.forEach((item) => {
    if (item._id === "chip-in") {
      chipIns = item.total;
    } else if (item._id === "withdrawal") {
      withdrawals = item.total;
    }
  });

  return Math.max(0, chipIns - withdrawals);
};

// Static method to get total chip-ins for an event
transactionSchema.statics.getTotalChipIns = async function (
  eventId: mongoose.Types.ObjectId,
) {
  const result = await this.aggregate([
    {
      $match: {
        event: eventId,
        type: "chip-in",
        status: "completed",
      },
    },
    {
      $group: {
        _id: "$event",
        totalAmount: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);

  return result.length > 0 ? result[0] : null;
};

const Transaction = mongoose.model<ITransaction, TransactionModel>(
  "Transaction",
  transactionSchema,
);

export default Transaction;
