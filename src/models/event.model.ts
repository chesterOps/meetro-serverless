import mongoose from "mongoose";
import { deleteImage } from "../middlewares/image";
import { DEFAULT_EVENT_IMAGES } from "../utils/helpers";
import Donation from "./donation.model";

function createEventSlug(event: {
  title: string;
  creator: mongoose.Types.ObjectId;
}) {
  return `${event.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")}-${event.creator.toString().slice(-4)}`;
}

// Event interface
export interface IEvent {
  _id: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  startDate: Date;
  font?: string;
  endDate: Date;
  location?: {
    venue: string;
    state: string;
    city: string;
    country: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  chipInDetails?: {
    chipInType: "fixed" | "target" | "donation";
    fixedAmount?: number;
    targetAmount?: number;
    minAmount?: number;
    bankDetails: {
      accountName: string;
      accountNumber: string;
      bankName: string;
      bankCode: string;
      recipientCode: string;
    };
  };

  eventType: "online" | "offline";
  meetingURL?: string;
  host: {
    name: string;
    email: string;
    photo?: string;
  };
  cohosts: {
    name: string;
    email: string;
    photo?: string;
  }[];
  image: {
    public_id?: string;
    url: string;
  };
  category: string[];
  isPrivate: boolean;
  isFeatured: boolean;
  creator: mongoose.Types.ObjectId;
  dressCode: {
    type: string;
    details?: string;
  };
  updateCount: number;
  slug: string;
  socials?: {
    facebook?: string;
    twitter?: string;
    instagram?: string;
    linkedin?: string;
    youtube?: string;
    tiktok?: string;
    gmail?: string;
  };
}

// Event model type
type EventModel = mongoose.Model<IEvent>;

// Event schema
const eventSchema = new mongoose.Schema<IEvent, EventModel>(
  {
    title: {
      type: String,
      required: [true, "Event title is required"],
      trim: true,
      maxlength: [100, "Title cannot exceed 100 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },
    font: {
      type: String,
      trim: true,
      maxlength: [50, "Font cannot exceed 50 characters"],
    },
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
      validate: {
        validator: function (this: any, value: Date) {
          if (this.isNew || this.isModified("startDate")) {
            return value > new Date();
          }
          return true;
        },
        message: "Start date must be in the future",
      },
    },
    slug: {
      type: String,
      unique: true,
    },
    eventType: {
      type: String,
      required: [true, "Event type is required"],
      enum: ["online", "offline"],
    },
    endDate: {
      type: Date,
      required: [true, "End date is required"],
      validate: {
        validator: function (this: any, value: Date) {
          return value > this.startDate;
        },
        message: "End date must be after start date",
      },
    },
    dressCode: {
      type: {
        type: String,
        enum: ["corporate", "casual", "traditional", "custom"],
      },
      details: {
        type: String,
        maxlength: [200, "Dress code details cannot exceed 200 characters"],
      },
    },
    location: {
      type: {
        venue: {
          type: String,
          required: [true, "Location venue is required"],
          trim: true,
        },
        state: {
          type: String,
          trim: true,
          required: [true, "Location state is required"],
        },
        city: {
          type: String,
          trim: true,
        },
        country: {
          type: String,
          trim: true,
        },
        coordinates: {
          type: {
            lat: Number,
            lng: Number,
          },
        },
      },
      required: [
        function (this: IEvent) {
          return this.eventType === "offline";
        },
        "Location is required for offline events",
      ],
    },
    image: {
      type: {
        public_id: String,
        url: String,
      },
      default: {
        url: `https://res.cloudinary.com/${
          process.env.CLOUDINARY_CLOUD_NAME
        }/image/upload/${
          DEFAULT_EVENT_IMAGES[
            Math.floor(Math.random() * DEFAULT_EVENT_IMAGES.length)
          ]
        }`,
      },
    },
    category: {
      type: [String],
      required: [true, "Event categories are required"],
      validate: {
        validator: function (arr: string[]) {
          return arr.length >= 1 && arr.length <= 4;
        },
        message: "Categories must have between 1 and 4 items",
      },
    },
    isPrivate: {
      type: Boolean,
      default: true,
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Event creator is required"],
    },
    host: {
      type: {
        name: String,
        email: String,
        photo: String,
      },
      required: [true, "Event host is required"],
    },
    cohosts: {
      type: [
        {
          name: String,
          email: String,
          photo: String,
        },
      ],
      default: [],
    },
    meetingURL: {
      type: String,
      validate: {
        validator: function (this: IEvent, value: string) {
          if (this.eventType === "online") {
            return /^https?:\/\/\S+$/.test(value);
          }
          return true;
        },
        message: "Meeting URL must be a valid URL",
      },
      required: [
        function (this: IEvent) {
          return this.eventType === "online";
        },
        "Meeting URL is required for online events",
      ],
    },
    updateCount: {
      type: Number,
      default: 0,
      select: false,
    },
    chipInDetails: {
      type: {
        chipInType: {
          type: String,
          enum: ["fixed", "target", "donation"],
          required: [true, "Chip-in type is required"],
        },
        fixedAmount: {
          type: Number,
          required: [
            function (this: IEvent) {
              return this.chipInDetails?.chipInType === "fixed";
            },
            "Fixed amount is required for fixed chip-in type",
          ],
        },
        targetAmount: {
          type: Number,
          required: [
            function (this: IEvent) {
              return this.chipInDetails?.chipInType === "target";
            },
            "Target amount is required for target chip-in type",
          ],
        },
        minAmount: {
          type: Number,
          required: [
            function (this: IEvent) {
              return this.chipInDetails?.chipInType === "donation";
            },
            "Minimum amount is required for donation chip-in type",
          ],
        },
        bankDetails: {
          type: {
            accountName: String,
            accountNumber: String,
            bankName: String,
            bankCode: String,
            recipientCode: String,
          },
          required: [true, "Bank details are required for chip-in"],
        },
      },
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
    isFeatured: {
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
eventSchema.index({ startDate: 1 });
eventSchema.index({ eventType: 1, startDate: 1 });
eventSchema.index({ creator: 1 });
eventSchema.index({ category: 1 });
eventSchema.index({ category: 1, startDate: 1 });
eventSchema.index({ "location.state": 1 });
eventSchema.index({ isFeatured: 1 });

// Virtual to populate guests from Response model
eventSchema.virtual("guests", {
  ref: "Response",
  localField: "_id",
  foreignField: "event",
});

// Virtual event status
eventSchema.virtual("status").get(function (this: IEvent) {
  const now = new Date();
  if (now < this.startDate) return "upcoming";
  if (now >= this.startDate && now <= this.endDate) return "ongoing";
  return "completed";
});

// Virtual donations details
eventSchema.virtual("donations").get(async function (this: IEvent) {
  if (this.chipInDetails) {
    const eventDonations = await Donation.getTotalDonations(this._id);
    return eventDonations;
  }
  return null;
});

// Populate host and cohosts on find queries
eventSchema.pre(/^find/, async function (this: mongoose.Query<any, any>) {
  this.populate([
    { path: "creator", select: "firstName lastName email photo" },
    { path: "guests", select: "user status -event" },
  ]);
});

eventSchema.pre("save", async function () {
  // Construct slug from title and creator ID
  if (this.isNew) {
    const doc = this as any;
    doc.slug = `${createEventSlug({
      title: doc.title,
      creator: doc.creator.toString(),
    })}`;
  }
});

eventSchema.post("findOneAndDelete", async function (doc) {
  if (doc && doc.image && doc.image.public_id) {
    // Delete event image from Cloudinary
    await deleteImage(doc.image.public_id);
  }

  // Delete all responses associated with the deleted event
  await mongoose.model("Response").deleteMany({ event: doc._id });
});

// Create and export model
const Event = mongoose.model<IEvent, EventModel>("Event", eventSchema);

export default Event;
