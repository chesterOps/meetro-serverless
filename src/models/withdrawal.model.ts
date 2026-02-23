import mongoose from "mongoose";

export interface IWithdrawal {
  event: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "failed";
  reference: string;
  transferCode?: string;
  gateway: string;
  createdAt: Date;
  updatedAt: Date;
}

type WithdrawalModel = mongoose.Model<IWithdrawal>;

const withdrawalSchema = new mongoose.Schema<IWithdrawal, WithdrawalModel>(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: [true, "Withdrawal must belong to an event"],
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Withdrawal must belong to a user"],
    },
    amount: {
      type: Number,
      required: [true, "Withdrawal amount is required"],
      min: [0, "Withdrawal amount must be positive"],
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
    status: {
      type: String,
      enum: {
        values: ["pending", "paid", "failed"],
        message: "Invalid withdrawal status",
      },
      default: "pending",
    },
    reference: {
      type: String,
      trim: true,
      unique: true,
    },
    transferCode: {
      type: String,
      trim: true,
    },
    gateway: {
      type: String,
      default: "paystack",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

withdrawalSchema.index({ event: 1, createdAt: -1 });
withdrawalSchema.index({ userId: 1, createdAt: -1 });

const Withdrawal = mongoose.model<IWithdrawal, WithdrawalModel>(
  "Withdrawal",
  withdrawalSchema,
);

export default Withdrawal;
