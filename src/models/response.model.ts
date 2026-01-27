import mongoose from "mongoose";

// Response interface
export interface IResponse {
  event: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  status: "going" | "maybe";
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
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
    },
    status: {
      type: String,
      enum: {
        values: ["going", "maybe"],
        message: "Status must be going or maybe",
      },
      required: [true, "Response status is required"],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

responseSchema.pre(/^find/, function (this: mongoose.Query<any, any>) {
  this.populate({
    path: "user",
    select: "firstName lastName email photo",
  });
});

// Compound index to ensure one response per user per event
responseSchema.index({ event: 1, user: 1 }, { unique: true });

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
