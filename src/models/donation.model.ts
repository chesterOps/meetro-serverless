import mongoose from "mongoose";
import AppError from "../utils/appError";
import { calculateFee } from "../utils/helpers";

// Donation interface
export interface IDonation {
  event: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  status: "pending" | "completed" | "refunded" | "failed";
  paymentReference?: string;
  metadata?: {
    transactionId?: string;
    gateway?: string;
    gatewayResponse?: any;
  };
  isPayoutEligible: boolean;
  settledAt?: Date;
  payoutStatus: "pending" | "paid" | "failed";
  fee: number;
  createdAt: Date;
  updatedAt: Date;
}

// Donation methods interface
interface IDonationMethods {
  isRefundable(): boolean;
}

// Donation static methods interface
interface IDonationStatics {
  getTotalDonations(eventId: mongoose.Types.ObjectId): Promise<{
    _id: mongoose.Types.ObjectId;
    totalAmount: number;
    totalDonations: number;
  } | null>;
}

// Donation model type
type DonationModel = mongoose.Model<IDonation, {}, IDonationMethods> &
  IDonationStatics;

// Donation schema
const donationSchema = new mongoose.Schema<
  IDonation,
  DonationModel,
  IDonationMethods
>(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: [true, "Donation must belong to an event"],
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Donation must belong to a user"],
    },
    amount: {
      type: Number,
      required: [true, "Donation amount is required"],
      min: [0, "Donation amount must be positive"],
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
      required: [true, "Transaction fee is required"],
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
        values: ["pending", "completed", "refunded", "failed"],
        message: "Invalid donation status",
      },
      default: "pending",
    },
    payoutStatus: {
      type: String,
      enum: {
        values: ["pending", "paid", "failed"],
        message: "Invalid payout status",
      },
      default: "pending",
    },
    paymentReference: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },

    metadata: {
      transactionId: String,
      gateway: String,
      gatewayResponse: mongoose.Schema.Types.Mixed,
    },
    isPayoutEligible: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes for better query performance
donationSchema.index({ event: 1, userId: 1 });
donationSchema.index({ status: 1 });
donationSchema.index({ createdAt: -1 });
donationSchema.index({ userId: 1, status: 1 });
donationSchema.index({ event: 1, status: 1 });
donationSchema.index({ payoutStatus: 1, status: 1 });

// Instance method to check if donation is refundable
donationSchema.methods.isRefundable = function (): boolean {
  if (this.status !== "completed") return false;

  // Allow refunds within 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  return this.createdAt > thirtyDaysAgo;
};

donationSchema.pre(/^find/, function (this: mongoose.Query<any, any>) {
  this.populate({ path: "userId", select: "firstName lastName email" });
});

// Static method to calculate total donations for an event
donationSchema.statics.getTotalDonations = async function (
  eventId: mongoose.Types.ObjectId,
) {
  const result = await this.aggregate([
    {
      $match: {
        event: eventId,
        status: "completed",
      },
    },
    {
      $group: {
        _id: "$event",
        totalAmount: { $sum: "$amount" },
        totalDonations: { $sum: 1 },
      },
    },
  ]);
  return result.length > 0 ? result[0] : null;
};

// Pre-save middleware to validate donation amount against event chip-in details
donationSchema.pre("save", async function () {
  if (this.isNew) {
    const Event = mongoose.model("Event");
    const event = await Event.findById(this.event);

    if (!event) {
      throw new AppError("Event not found", 404);
    }

    // Check if event has chip-in details
    if (event.chipInDetails) {
      const { minAmount, fixedAmount } = event.chipInDetails;

      if (
        event.chipInDetails.chipInType === "donation" &&
        this.amount < minAmount
      ) {
        throw new AppError(
          `Donation amount must be at least ${this.currency} ${minAmount}`,
          400,
        );
      }

      if (
        event.chipInDetails.chipInType === "fixed" &&
        this.amount !== fixedAmount
      ) {
        throw new AppError(
          `Donation amount must be exactly ${this.currency} ${fixedAmount}`,
          400,
        );
      }
    }

    // Calculate and set the transaction fee
    this.fee = calculateFee(this.amount);
  }
});

// Create and export the Donation model
const Donation = mongoose.model<IDonation, DonationModel>(
  "Donation",
  donationSchema,
);

export default Donation;
