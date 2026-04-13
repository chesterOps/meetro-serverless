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
  role: "user" | "admin";
  password: string;
  active: boolean;
  passwordChangedAt?: Date;
  googleId?: string;
  preferences: {
    profileVisibility: "public" | "private";
    socialMediaVisibility: "public" | "private";
    notificationMode: "email" | "phone";
    eventReminders: boolean;
    eventUpdates: boolean;
    guestRegistrations: boolean;
    productUpdates: boolean;
    eventFeesPaidBy: "user" | "organizer";
  };
  bankDetails?: {
    accountNumber: string;
    bankName: string;
    bankCode: string;
    accountName: string;
    recipientCode: string;
  };
  socials?: {
    facebook?: string;
    twitter?: string;
    instagram?: string;
    linkedin?: string;
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
    preferences: {
      type: {
        profileVisibility: {
          type: String,
          enum: ["public", "private"],
          default: "public",
        },
        socialMediaVisibility: {
          type: String,
          enum: ["public", "private"],
          default: "public",
        },
        notificationMode: {
          type: String,
          enum: ["email", "phone"],
          default: "email",
        },
        eventReminders: {
          type: Boolean,
          default: false,
        },
        eventUpdates: {
          type: Boolean,
          default: false,
        },
        guestRegistrations: {
          type: Boolean,
          default: false,
        },
        productUpdates: {
          type: Boolean,
          default: false,
        },
        eventFeesPaidBy: {
          type: String,
          enum: ["user", "organizer"],
          default: "organizer",
        },
      },
    },
    googleId: {
      type: String,
      select: false,
    },
    socials: {
      facebook: {
        type: String,
      },
      twitter: {
        type: String,
      },
      instagram: {
        type: String,
      },
      linkedin: {
        type: String,
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
    bankDetails: {
      accountNumber: {
        type: String,
      },
      bankName: {
        type: String,
      },
      bankCode: {
        type: String,
      },
      recipientCode: {
        type: String,
      },
      accountName: {
        type: String,
      },
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
