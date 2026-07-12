import mongoose from "mongoose";

// Response interface
export interface IResponse {
  event: mongoose.Types.ObjectId;
  user?: mongoose.Types.ObjectId;
  guestEmail?: string;
  guestName?: string;
  status: "going" | "maybe";
  amountPaid?: number;
}

// Response model type
type ResponseModel = mongoose.Model<IResponse>;

// Response schema
const responseSchema = new mongoose.Schema<IResponse, ResponseModel>(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: [true, "Event is required"],
    },
    // Either `user` (platform account) or `guestEmail` (no account) must
    // be present — never both, never neither.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function (this: IResponse) {
        return !this.guestEmail;
      },
    },
    guestEmail: {
      type: String,
      trim: true,
      lowercase: true,
      required: function (this: IResponse) {
        return !this.user;
      },
    },
    guestName: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: ["going", "maybe"],
        message: "Status must be going or maybe",
      },
      required: [true, "Response status is required"],
    },
    amountPaid: {
      type: Number,
      default: 0,
      min: [0, "Amount paid must be non-negative"],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

responseSchema.pre(/^find/, async function (this: mongoose.Query<any, any>) {
  this.populate({
    path: "user",
    select: "firstName lastName email photo",
  });
});

responseSchema.pre(/^find/, async function (this: mongoose.Query<any, any>) {
  this.populate({
    path: "user",
    select: "firstName lastName email photo",
  });
});

// One response per platform user per event (partial index so guest-only
// docs, which have no `user` field, don't collide on a shared "missing" value)
responseSchema.index(
  { event: 1, user: 1 },
  { unique: true, partialFilterExpression: { user: { $exists: true } } },
);

// One response per guest email per event (same partial-index reasoning)
responseSchema.index(
  { event: 1, guestEmail: 1 },
  { unique: true, partialFilterExpression: { guestEmail: { $exists: true } } },
);

// Index for querying responses by event
responseSchema.index({ event: 1, status: 1 });

// Index for querying user's responses
responseSchema.index({ user: 1 });

// Create and export model
const Response = mongoose.model<IResponse, ResponseModel>(
  "Response",
  responseSchema,
);

export default Response;
