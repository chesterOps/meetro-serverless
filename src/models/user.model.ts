import bcrypt from "bcryptjs";
import mongoose from "mongoose";

// User interface
export interface IUser extends mongoose.Document {
  firstName: string;
  lastName: string;
  email: string;
  photo?: {
    public_id?: string;
    url: string;
  };
  phone?: string;
  role: "user" | "admin";
  password: string;
  interests: string[];
  bio?: string;
  active: boolean;
  passwordChangedAt?: Date;
  googleId?: string;
  socials?: {
    facebook?: string;
    twitter?: string;
    instagram?: string;
    linkedin?: string;
    youtube?: string;
    tiktok?: string;
    gmail?: string;
  };
  address?: string;
  verified: boolean;
  refreshToken?: string;
  accessTokenVersion: number;
}

// User methods interface
interface IUserMethods {
  verifyPassword(password: string, dbPassword: string): Promise<boolean>;
  changedPasswordAfter(tokenTimestamp: number): boolean;
}

// User model type
type UserModel = mongoose.Model<IUser, {}, IUserMethods>;

// User schema
const userSchema = new mongoose.Schema<IUser, UserModel, IUserMethods>(
  {
    firstName: {
      type: String,
      required: [true, "First name is required"],
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      match: [/^\S+@\S+\.\S+$/, "Email is invalid"],
      set: (value: string) => value.toLowerCase(),
    },
    photo: {
      type: {
        public_id: String,
        url: String,
      },
    },
    phone: {
      type: String,
      unique: true,
      sparse: true,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    password: {
      type: String,
      select: false,
      default: undefined,
    },
    interests: {
      type: [String],
      validate: {
        validator: function (arr: string[]) {
          return arr.length <= 6;
        },
        message: "Interests cannot exceed 6 items",
      },
    },

    bio: {
      type: String,
      maxlength: [500, "Bio must be at most 500 characters"],
      trim: true,
    },
    active: {
      type: Boolean,
      default: true,
      select: false,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    passwordChangedAt: {
      type: Date,
      select: false,
    },
    googleId: {
      type: String,
      select: false,
    },
    socials: {
      type: {
        facebook: String,
        twitter: String,
        instagram: String,
        linkedin: String,
        youtube: String,
        tiktok: String,
        gmail: String,
      },
    },
    address: {
      type: String,
    },
    refreshToken: {
      type: String,
      select: false,
    },
    accessTokenVersion: {
      type: Number,
      default: 0,
      select: false,
    },
  },
  {
    methods: {
      // Verify password
      async verifyPassword(
        password: string,
        dbPassword: string,
      ): Promise<boolean> {
        return await bcrypt.compare(password, dbPassword);
      },

      // Check if password was changed after token was issued
      changedPasswordAfter(tokenTimestamp: number) {
        // Check for field
        if (this.passwordChangedAt) {
          // Get timestamp when password was changed
          const changedTimestamp = parseInt(
            (this.passwordChangedAt.getTime() / 1000).toString(),
            10,
          );

          // Compare values
          return tokenTimestamp < changedTimestamp;
        }

        return false;
      },
    },
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Virtual for full name
userSchema.virtual("fullName").get(function (this: IUser) {
  return `${this.firstName} ${this.lastName}`;
});

// Query middleware to filter out inactive users
userSchema.pre(/^find/, async function (this: mongoose.Query<any, any>) {
  this.where({ active: { $ne: false } });
});

// Encrypt password on save
userSchema.pre("save", async function () {
  // Check if password field was modified
  if (!this.isModified("password") || !this.password) return;

  // Hash password
  this.password = await bcrypt.hash(this.password, 12);

  // Updating password changed time
  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);
});

// Create user model
const User = mongoose.model<IUser, UserModel>("User", userSchema);

export default User;
