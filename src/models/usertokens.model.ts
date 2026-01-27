import mongoose from "mongoose";
import crypto from "crypto";
import User from "./user.model";
import AppError from "../utils/appError";

// Token types
export type TokenType = "password-reset" | "email-verification";

// User token interface
interface IUserToken extends mongoose.Document {
  user: mongoose.Types.ObjectId;
  token: string;
  type: TokenType;
  expiresAt: Date;
  attempts: number;
  lastSentAt?: Date;
}

// User token methods interface
interface IUserTokenMethods {
  isExpired(): boolean;
  checkAttempts(maxAttempts: number): boolean;
}

// User token model type
type UserTokenModel = mongoose.Model<IUserToken, {}, IUserTokenMethods>;

// User token schema
const userTokenSchema = new mongoose.Schema<
  IUserToken,
  UserTokenModel,
  IUserTokenMethods
>(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
      index: true,
    },
    token: {
      type: String,
      required: [true, "Token is required"],
      unique: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["password-reset", "email-verification"],
      required: [true, "Token type is required"],
    },
    expiresAt: {
      type: Date,
      required: [true, "Expiration date is required"],
    },
    attempts: {
      type: Number,
      default: 0,
    },
    lastSentAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Index for automatic cleanup of expired tokens
userTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for faster lookups
userTokenSchema.index({ user: 1, type: 1 });

// Method to check if token is expired
userTokenSchema.methods.isExpired = function (): boolean {
  return this.expiresAt < new Date();
};

// Method to check if max attempts exceeded
userTokenSchema.methods.checkAttempts = function (
  maxAttempts: number,
): boolean {
  return this.attempts >= maxAttempts;
};

// Static method to create a new token
userTokenSchema.statics.createToken = async function (
  userId: mongoose.Types.ObjectId,
  type: TokenType,
  expirationMinutes: number = 15,
): Promise<string> {
  // Check if user exists
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError("User not found", 404);
  }

  // Check for existing recent token to prevent spamming
  const oldToken = await this.findOne({ user: userId, type });
  const timeInterval = 60000; // 1 minute
  if (
    oldToken?.lastSentAt &&
    new Date().getTime() - oldToken.lastSentAt.getTime() < timeInterval
  ) {
    throw new AppError(
      "Token was sent recently. Please wait before requesting a new one.",
      429,
    );
  }
  let token: string;
  if (type === "email-verification") {
    // Generate a 6-digit numeric token for email verification
    token = Math.floor(100000 + Math.random() * 900000).toString();
  } else {
    // Generate a random token for other types
    token = crypto.randomBytes(32).toString("hex");
  }

  // Hash the token
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  // Calculate expiration date
  const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000);

  // Add lastSentAt timestamp
  const lastSentAt = new Date();

  // Delete any existing tokens of the same type for this user
  await this.deleteMany({ user: userId, type });

  // Create new token
  await this.create({
    user: userId,
    token: hashedToken,
    type,
    expiresAt,
    lastSentAt,
  });

  // Return token
  return token;
};

// Static method to verify a token
userTokenSchema.statics.verifyToken = async function (
  token: string,
  type: TokenType,
  email: string,
): Promise<void> {
  // Hash the provided token
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  // Fetch user
  const user = await User.findOne({ email });
  if (!user) throw new AppError("User not found", 404);

  // Get token document and populate user
  const tokenDoc = await this.findOne({
    user: user._id,
    type,
  });

  // Check if token exists
  if (!tokenDoc) {
    throw new AppError("Invalid or expired token", 400);
  }

  // Check if token is valid
  if (tokenDoc.isExpired() || tokenDoc.checkAttempts(5)) {
    throw new AppError("Invalid or expired token", 400);
  }

  if (tokenDoc.token !== hashedToken) {
    // Update attempts
    tokenDoc.attempts += 1;
    await tokenDoc.save();
    throw new AppError("Token is invalid", 400);
  }

  // Delete token after successful verification
  await this.deleteOne({ _id: tokenDoc._id });
};

// Static method to delete user tokens
userTokenSchema.statics.deleteUserTokens = async function (
  userId: mongoose.Types.ObjectId,
  type?: TokenType,
): Promise<void> {
  const query: { user: mongoose.Types.ObjectId; type?: TokenType } = {
    user: userId,
  };

  if (type) {
    query.type = type;
  }

  await this.deleteMany(query);
};

// Static method to cleanup expired tokens (manual cleanup)
userTokenSchema.statics.cleanupExpired = async function (): Promise<number> {
  const result = await this.deleteMany({
    expiresAt: { $lt: new Date() },
  });

  return result.deletedCount || 0;
};

// Add static methods to model type
interface UserTokenModelWithStatics extends UserTokenModel {
  createToken(
    userId: mongoose.Types.ObjectId,
    type: TokenType,
    expirationMinutes?: number,
  ): Promise<string>;
  verifyToken(token: string, type: TokenType, email: string): Promise<void>;
  deleteUserTokens(
    userId: mongoose.Types.ObjectId,
    type?: TokenType,
  ): Promise<void>;
  cleanupExpired(): Promise<number>;
}

const UserToken = mongoose.model<IUserToken, UserTokenModelWithStatics>(
  "UserToken",
  userTokenSchema,
);

export default UserToken;
