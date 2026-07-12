import Transaction from "../models/transaction.model";
import Event from "../models/event.model";
import Response from "../models/response.model";
import User from "../models/user.model";
import AppError from "../utils/appError";
import catchAsync from "../utils/catchAsync";
import Email from "../utils/email";

import { deleteImage } from "../middlewares/image";
import { isValidObjectId } from "mongoose";
import { paystack } from "../paystack/paystackSettlementPoller";
import { buildICS, formatDate, formatTime, toBase64 } from "../utils/helpers";

// Helper function to format guest data for response
const formatGuestData = (
  user: any,
  guestFallback?: { guestName?: string; guestEmail?: string },
) => {
  if (!user) {
    return {
      name: guestFallback?.guestName || guestFallback?.guestEmail || "Guest",
      email: guestFallback?.guestEmail,
      hasAccount: false,
    };
  }

  const data: { [key: string]: any } = {
    name: `${user.firstName} ${user.lastName}`,
    email: user.email,
    hasAccount: true,
  };
  if (user.photo) data.photo = user.photo.url;
  return data;
};

// Helper function to normalize cohost data
const normalizeCohost = (cohost: any, matchedUser?: any) => {
  const formattedCohost: any = {
    role: cohost.role,
  };

  if (matchedUser) {
    formattedCohost.id = matchedUser._id;
  } else if (cohost.id) {
    formattedCohost.id = cohost.id;
  }

  if (cohost.name) formattedCohost.name = cohost.name;
  if (cohost.email) formattedCohost.email = cohost.email;
  // photo is { public_id, url } — either freshly uploaded by
  // uploadEventImages, or resent as-is by the client to preserve it
  if (cohost.photo && cohost.photo.url) formattedCohost.photo = cohost.photo;

  return formattedCohost;
};

// Helper function to format event data for response
const formatEventData = (
  event: any,
  options?: {
    skipGuests?: boolean;
    skipUpdateCount?: boolean;
    skipBalance?: boolean;
    // When true, cohost.photo is left as the raw { public_id, url }
    // object instead of being flattened to a URL string. Used for the
    // host-only management view, where the edit form needs public_id
    // to correctly diff/preserve cohost photos on save.
    rawCohostPhotos?: boolean;
  },
) => {
  const eventObj = event.toObject ? event.toObject() : { ...event };

  // Extract and format image
  if (eventObj.image) {
    eventObj.image = eventObj.image.url;
  }

  if (options?.skipUpdateCount) {
    delete eventObj.updateCount;
  }

  if (options?.skipBalance) {
    delete eventObj.balance;
  }

  // Format guests to include user details
  if (!options?.skipGuests && eventObj.guests && eventObj.guests.length > 0) {
    eventObj.guests = eventObj.guests.map((guest: any) => {
      const user = formatGuestData(guest.user, {
        guestName: guest.guestName,
        guestEmail: guest.guestEmail,
      });

      if (!options?.skipBalance) {
        user.amountPaid = guest.amountPaid || 0;
        user.date = guest.createdAt;
        user.status = guest.status;
      }
      return user;
    });
  }
  // Format cohosts
  if (eventObj.cohosts && eventObj.cohosts.length > 0) {
    eventObj.cohosts = eventObj.cohosts.map((cohost: any) => {
      // If cohost.id is a populated user object
      if (cohost.id && cohost.id._id) {
        const formattedUser = formatGuestData(cohost.id);
        return {
          ...formattedUser,
          id: cohost.id._id,
          role: cohost.role,
          hasAccount: cohost.hasAccount,
          ...(cohost.photo
            ? {
                photo: options?.rawCohostPhotos
                  ? cohost.photo
                  : cohost.photo.url,
              }
            : {}),
        };
      }
      // If not populated or just an email invite
      return {
        id: cohost.id,
        name: cohost.name,
        email: cohost.email,
        photo: options?.rawCohostPhotos ? cohost.photo : cohost.photo?.url,
        role: cohost.role,
        hasAccount: cohost.hasAccount,
      };
    });
  }

  return eventObj;
};

export const deleteEvent = catchAsync(async (req, res, next) => {
  // Get user from res.locals
  const user = res.locals.user;
  // Get event ID
  const eventId = req.params.id;

  const event = await Event.findOne({ _id: eventId });

  if (!event) return next(new AppError("Event not found", 404));

  // Check if user is host
  if (event.host._id.toString() !== user._id.toString()) {
    return next(
      new AppError("You do not have permission to delete this event.", 403),
    );
  }
  // Check for active chip-ins
  const chipInData = await Transaction.getTotalChipIns(event._id);
  if (chipInData && chipInData.count > 0) {
    return next(
      new AppError(
        "Cannot delete event with active chip-ins. Please contact support.",
        403,
      ),
    );
  }

  // Check if event has balance
  const balance = await Transaction.getEventBalance(event._id);
  if (balance > 0) {
    return next(
      new AppError(
        "Cannot delete event with available balance. Please contact support.",
        403,
      ),
    );
  }

  // Find and delete event
  await Event.findByIdAndDelete(eventId);

  // Send response
  res.status(204).json({
    status: "success",
    data: null,
  });
});

export const createEvent = catchAsync(async (req, res, next) => {
  // If meetingURL is provided, set eventType to "online"
  if (req.body.meetingURL) req.body.eventType = "online";
  else req.body.eventType = "offline";
  // Set user as host
  const userId = res.locals.user._id;
  req.body.host = userId;

  if (typeof req.body.isPrivate === "string") {
    req.body.isPrivate = req.body.isPrivate === "true";
  }

  // Default isPrivate to true if not provided
  req.body.isPrivate ??= true;

  // Remove chipInDetails if event is public
  if (req.body.isPrivate === false && req.body.chipInDetails) {
    delete req.body.chipInDetails;
  } else if (req.body.isPrivate === true && req.body.chipInDetails) {
    const bankDetails = req.body.chipInDetails.bankDetails;

    // Create recipient code for chipInDetails
    try {
      const response = await paystack.post("/transferrecipient", {
        type: "nuban",
        name: bankDetails.accountName,
        account_number: bankDetails.accountNumber,
        bank_code: bankDetails.bankCode,
        currency: "NGN",
      });
      // If successful, add recipientCode to chipInDetails
      if (response.data.status) {
        req.body.chipInDetails.bankDetails.recipientCode =
          response.data.data.recipient_code;
      }
    } catch (err: any) {
      return next(
        new AppError(err.response?.data?.message || err.message, 500),
      );
    }
  }

  // Process cohosts
  if (req.body.cohosts && req.body.cohosts.length > 0) {
    // Check if cohosts are on platform
    const cohostUsers = await User.find({
      email: { $in: req.body.cohosts.map((cohost: any) => cohost.email) },
    });
    if (cohostUsers && cohostUsers.length > 0) {
      req.body.cohosts = req.body.cohosts.map((cohost: any) => {
        const matchedUser = cohostUsers.find(
          (user) => user.email === cohost.email,
        );
        return normalizeCohost(cohost, matchedUser);
      });
    } else {
      req.body.cohosts = req.body.cohosts.map((cohost: any) =>
        normalizeCohost(cohost),
      );
    }
  } else {
    req.body.cohosts = [];
  }

  // Create event
  const event = await Event.create(req.body);

  // Collect "going" response payloads for host + all cohosts.
  // Host and account-linked cohosts get a user-linked response;
  // no-account cohosts get a guestEmail-linked response instead.
  const responsesToCreate: any[] = [];
  const seenUserIds = new Set<string>();

  if (event.host) {
    responsesToCreate.push({
      event: event._id,
      user: event.host,
      status: "going",
    });
    seenUserIds.add(event.host.toString());
  }

  if (event.cohosts && event.cohosts.length > 0) {
    event.cohosts.forEach((cohost: any) => {
      if (cohost.id) {
        const idStr = cohost.id.toString();
        if (!seenUserIds.has(idStr)) {
          responsesToCreate.push({
            event: event._id,
            user: cohost.id,
            status: "going",
          });
          seenUserIds.add(idStr);
        }
      } else if (cohost.email) {
        responsesToCreate.push({
          event: event._id,
          guestEmail: cohost.email,
          guestName: cohost.name,
          status: "going",
        });
      }
    });
  }

  // Create all responses, ignoring duplicate-key errors (e.g. same
  // email listed twice) so one bad entry doesn't fail the whole batch
  const responsePromises = responsesToCreate.map((data) =>
    Response.create(data).catch((err: any) => {
      if (err.code !== 11000) throw err;
    }),
  );

  // Await response creations
  await Promise.all(responsePromises);

  // Prepare response data
  const eventData = formatEventData(event, {
    skipGuests: true,
    skipUpdateCount: true,
    skipBalance: true,
  });

  // Send response
  res.status(201).json({
    status: "success",
    data: eventData,
  });
});

export const getEvent = (isProtected = false) =>
  catchAsync(async (req, res, next) => {
    let user;
    // Get user from res.locals if authenticated
    if (res.locals.user) user = res.locals.user;

    // Get event ID from params
    const eventId = req.params.id;

    // Check if eventId is slug
    const isSlug = !isValidObjectId(eventId);

    // Find event by ID or slug
    let event;
    // If slug, find by slug
    if (isSlug) {
      event = await Event.findOne({ slug: eventId }).select("+updateCount");
    } else {
      event = await Event.findById(eventId).select("+updateCount");
    }
    // If event not found, return error
    if (!event) return next(new AppError("Event not found", 404));

    if (isProtected && user._id.toString() !== event.host._id.toString()) {
      return next(
        new AppError("You do not have permission to view this event.", 403),
      );
    }

    // Check if user exists and is host
    const isHost = user && event.host._id.toString() === user._id.toString();
    const isCohost =
      user &&
      event.cohosts.some(
        (cohost: any) => cohost.id?.toString() === user._id.toString(),
      );

    // Format event data - hide balance from non-hosts.
    // rawCohostPhotos: only the protected/management view needs the raw
    // { public_id, url } cohost photo object; the public view keeps it
    // flattened to a plain URL string.
    const eventData = formatEventData(event, {
      skipUpdateCount: !isHost,
      skipBalance: !isHost,
      rawCohostPhotos: isProtected,
    });

    // If user is host, add balance and total chip-ins to response
    if (isHost) {
      const balance = await Transaction.getEventBalance(event._id);
      eventData.balance = balance;
    }

    // Add chip data to response if event has chip-in details
    if (event.chipInDetails) {
      const chipInData = await Transaction.getTotalChipIns(event._id);
      eventData.totalDonations = chipInData ? chipInData.totalAmount : 0;
    }

    // Add guest count to response
    const guestCount = await event.getGuestCount();
    eventData.guestCount = guestCount;

    // Check if user exists
    if (user) {
      if (isHost) eventData.userRole = "host";
      else if (isCohost) eventData.userRole = "cohost";
      else eventData.userRole = "guest";

      // Find user's response to the event
      const userResponse = await Response.findOne({
        user: user._id,
        event: event._id,
      });

      // If user has responded, add response status
      if (userResponse) eventData.userResponse = userResponse.status;
    }

    // Send response
    res.status(200).json({
      status: "success",
      data: eventData,
    });
  });

export const getMyEvents = catchAsync(async (req, res, _next) => {
  // Get user from res.locals
  const user = res.locals.user;

  // Pagination
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const skip = (page - 1) * limit;

  // Filter by time (all, upcoming, past)
  const filter = (req.query.filter as string) || "all";
  const now = new Date();

  let dateFilter: any = {};
  if (filter === "upcoming") {
    dateFilter = { startDate: { $gte: now } };
  } else if (filter === "past") {
    // For past events, we check if endDate is in the past. If no endDate, we check if startDate is in the past

    dateFilter = {
      $or: [
        { endDate: { $lt: now } },
        {
          $and: [{ endDate: { $exists: false } }, { startDate: { $lt: now } }],
        },
      ],
    };
  }

  // Use aggregation for efficient pagination
  const results = await Event.aggregate([
    // 1. Lookup for CURRENT USER'S confirmed response (status: "going")
    {
      $lookup: {
        from: "responses",
        let: { eventId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$event", "$$eventId"] },
                  { $eq: ["$user", user._id] },
                  { $eq: ["$status", "going"] },
                ],
              },
            },
          },
        ],
        as: "currentUserResponse",
      },
    },
    // 2. Filter to only include events where user has confirmed attendance
    {
      $match: {
        currentUserResponse: { $ne: [] },
        ...dateFilter,
      },
    },
    // 3. Lookup for CURRENT USER'S full response details (for userResponse field)
    {
      $lookup: {
        from: "responses",
        let: { eventId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$event", "$$eventId"] },
                  { $eq: ["$user", user._id] },
                ],
              },
            },
          },
        ],
        as: "userResponseDetails",
      },
    },
    // 3. Lookup for guests: first 10 guests and guest count
    {
      $lookup: {
        from: "responses",
        let: { eventId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$event", "$$eventId"] } } },
          {
            $lookup: {
              from: "users",
              localField: "user",
              foreignField: "_id",
              as: "userProfile",
            },
          },
          { $unwind: "$userProfile" },
          {
            $project: {
              name: {
                $concat: [
                  { $ifNull: ["$userProfile.firstName", ""] },
                  " ",
                  { $ifNull: ["$userProfile.lastName", ""] },
                ],
              },
              email: "$userProfile.email",
              photo: "$userProfile.photo",
              amountPaid: "$userProfile.amountPaid",
            },
          },
        ],
        as: "allGuests",
      },
    },
    // 3b. Add guests (first 10) and guestCount fields
    {
      $addFields: {
        guests: { $slice: ["$allGuests", 10] },
        guestCount: { $size: "$allGuests" },
      },
    },
    {
      $project: {
        allGuests: 0,
      },
    },
    // 4. Add Fields for logic
    {
      $addFields: {
        userResponse: {
          $ifNull: [
            { $arrayElemAt: ["$userResponseDetails.status", 0] },
            "going",
          ],
        },
        userRole: "guest",
      },
    },
    { $sort: { createdAt: -1 } },
    // 5. Final Pagination Facet
    {
      $facet: {
        metadata: [{ $count: "total" }],
        data: [
          { $skip: skip },
          { $limit: limit },
          { $project: { currentUserResponse: 0, userResponseDetails: 0 } },
        ],
      },
    },
  ]);

  const totalEvents = results[0]?.metadata[0]?.total || 0;
  const events = results[0]?.data || [];

  // Format events using helper and add status
  const formattedEvents = events.map((event: any) => {
    const eventData = formatEventData(event, {
      skipGuests: true,
      skipBalance: true,
      skipUpdateCount: true,
    });
    let status = "upcoming";
    if (event.startDate) {
      const start = new Date(event.startDate);
      if (now < start) {
        status = "upcoming";
      } else if (event.endDate) {
        const end = new Date(event.endDate);
        if (now >= start && now <= end) {
          status = "live now";
        } else if (now > end) {
          status = "completed";
        }
      } else {
        // If no endDate, event has past if current date is after startDate
        status = "completed";
      }
    }
    return { ...eventData, status };
  });

  // Send response
  res.status(200).json({
    status: "success",
    results: formattedEvents.length,
    total: totalEvents,
    page,
    data: formattedEvents,
    hasMore: page * limit < totalEvents,
  });
});

export const updateEvent = catchAsync(async (req, res, next) => {
  // Get user from res.locals
  const user = res.locals.user;
  // Get event ID from params
  const eventId = req.params.id;
  // Find event by ID
  const event = await Event.findById(eventId).select("+updateCount");

  // If not found, return error
  if (!event) return next(new AppError("Event not found", 404));

  // Check if user has permission to update
  const isHost = event.host._id.toString() === user._id.toString();

  const isAdmin = user.role === "admin";

  if (!isAdmin && !isHost) {
    return next(
      new AppError("You do not have permission to update this event.", 403),
    );
  }

  // Check updateCount limit (skip for admins)
  if (!isAdmin && event.updateCount >= 3) {
    return next(
      new AppError(
        "You have reached the maximum number of updates for this event.",
        400,
      ),
    );
  }

  // Capture existing cohost photos BEFORE they get overwritten below,
  // keyed by public_id so we can diff against the incoming set later
  const oldCohostPublicIds = new Set(
    (event.cohosts || []).map((c: any) => c.photo?.public_id).filter(Boolean),
  );

  // Process cohosts
  if (req.body.cohosts && req.body.cohosts.length > 0) {
    const cohostUsers = await User.find({
      email: { $in: req.body.cohosts.map((cohost: any) => cohost.email) },
    });
    if (cohostUsers && cohostUsers.length > 0) {
      req.body.cohosts = req.body.cohosts.map((cohost: any) => {
        const matchedUser = cohostUsers.find(
          (user) => user.email === cohost.email,
        );
        return normalizeCohost(cohost, matchedUser);
      });
    } else {
      req.body.cohosts = req.body.cohosts.map((cohost: any) =>
        normalizeCohost(cohost),
      );
    }
  } else {
    req.body.cohosts = [];
  }

  // Diff: any old cohost photo not present in the new cohosts list
  // (either the cohost was removed, or their photo was replaced) gets deleted
  const newCohostPublicIds = new Set(
    req.body.cohosts.map((c: any) => c.photo?.public_id).filter(Boolean),
  );

  const cohostPhotosToDelete = Array.from(oldCohostPublicIds).filter(
    (publicId) => !newCohostPublicIds.has(publicId),
  );

  if (cohostPhotosToDelete.length > 0) {
    await Promise.all(
      cohostPhotosToDelete.map((publicId) => deleteImage(publicId as string)),
    );
  }

  // Check for new event image and delete old image if necessary
  if (req.body.image && event.image && event.image.public_id)
    await deleteImage(event.image.public_id);

  // Update event with new data
  Object.assign(event, req.body);

  // Adjust event location and meetingURL based on eventType
  switch (event.eventType) {
    case "online":
      event.location = undefined;
      break;
    case "offline":
      event.meetingURL = undefined;
      break;
  }

  // Increment updateCount if not admin
  if (!isAdmin) event.updateCount += 1;

  // Save updated event
  await event.save({
    validateBeforeSave: false,
  });

  // Prepare response data
  const eventData = formatEventData(event);

  // Send response
  res.status(200).json({
    status: "success",
    data: eventData,
  });
});
export const getUserEventCounts = catchAsync(async (_req, res, _next) => {
  const user = res.locals.user;
  // Get user events count
  const createdEventsCount = await Event.find({
    host: user._id.toString(),
  }).countDocuments();

  const userResponses = await Response.find({
    user: user._id.toString(),
    status: "going",
  });

  const attendedEventsCount = await Event.find({
    _id: { $in: userResponses.map((response) => response.event) },
    host: { $ne: user._id.toString() },
    endDate: { $lt: new Date() },
  }).countDocuments();

  // Send response
  res.status(200).json({
    status: "success",
    data: {
      created: createdEventsCount,
      attended: attendedEventsCount,
    },
  });
});

export const confirmAttendance = catchAsync(async (req, res, next) => {
  // Get response status from body
  const { responseStatus, eventId } = req.body;

  if (!responseStatus)
    return next(new AppError("Response status is required", 400));
  // Get user from res.locals
  const user = res.locals.user;

  // Find event by ID
  const event = await Event.findById(eventId);

  // If event not found, return error
  if (!event) return next(new AppError("Event not found", 404));

  // Check if user is the host
  if (event.host._id.toString() === user._id.toString()) {
    return next(
      new AppError("Host cannot confirm attendance to their own event.", 400),
    );
  }
  // Check if user has already responded
  let response = await Response.findOne({ user: user._id, event: event._id });
  if (response) {
    // Update response status
    response.status = responseStatus;
    await response.save();
  } else {
    // Create new response with status from request body
    const responseData = {
      user: user._id,
      event: event._id,
      status: responseStatus,
    } as { [key: string]: any };
    response = await Response.create(responseData);
  }

  if (!response || response.status !== responseStatus) {
    // Send confirmation email
    try {
      // Check if status is going
      if (responseStatus === "going") {
        // Construct location string for offline events
        let location;
        if (event.eventType === "offline" && event.location) {
          location = [];
          if (event.location.city) location.push(`${event.location.city}`);
          if (event.location.state) location.push(`${event.location.state}`);
          if (event.location.country)
            location.push(`${event.location.country}`);
          location = location.join(", ");
        }

        // Construct dress code string
        let dressCode;
        if (event.dressCode && event.dressCode.type) {
          dressCode = event.dressCode.type;
          if (event.dressCode.details) {
            dressCode += ` - ${event.dressCode.details}`;
          }
        }

        let attachments;
        // Build ics file attachment if status is going and send with email

        const icsContentData = {
          title: event.title,
          description: event.description || "",
          startDate: new Date(event.startDate),
          endDate: new Date(event.endDate),
          eventID: event._id.toString(),
        } as {
          startDate: Date;
          endDate: Date;
          title: string;
          eventID: string;
          description?: string;
          location?: string;
        };

        // Add location if offline event
        if (event.eventType === "offline" && location)
          icsContentData.location = `${event.location?.venue || ""}, ${location}`;

        const icsContent = buildICS(icsContentData);
        // Prepare attachments array
        attachments = [
          {
            filename: `${event.slug}.ics`,
            content: toBase64(icsContent),
            content_type: "text/calendar; method=REQUEST; charset=UTF-8",
          },
        ];

        // Construct date and time strings
        const eventDate = formatDate(new Date(event.startDate));
        const eventTime = formatTime(new Date(event.startDate));

        // Construct map URL
        const eventMapUrl =
          event.location && event.location.coordinates
            ? `https://www.google.com/maps/search/?api=1&query=${event.location.coordinates.lat},${event.location.coordinates.lng}`
            : "";

        // Send going confirmation email
        await new Email({
          url: `${process.env.FRONT_URL}/event/${event.slug}`,
          to: user.email,
        }).sendGoing({
          eventName: event.title,
          eventImage: event.image?.url || "",
          meetingUrl: event.meetingURL || "",
          dressCode: dressCode || "",
          eventDate,
          eventTime,
          eventVenue: event.location?.venue || "",
          eventLocation: location || "",
          eventMapUrl,
          name: user.firstName,
          attachments,
        });
      }

      // Send maybe confirmation email
      if (responseStatus === "maybe") {
        await new Email({
          url: `${process.env.FRONT_URL}/event/${event.slug}`,
          to: user.email,
        }).sendMaybe({
          eventName: event.title,
          eventImage: event.image?.url || "",
          name: user.firstName,
        });
      }
    } catch {
      console.warn("Error sending email.");
    }
  }

  // Send response
  res.status(200).json({
    status: "success",
    message: `Attendance marked as ${responseStatus}`,
  });
});

export const getAllGuests = catchAsync(async (req, res, next) => {
  const user = res.locals.user;
  // Get event ID from params
  const eventId = req.params.id;

  // Check if eventId is valid ObjectId or slug
  const isSlug = !isValidObjectId(eventId);

  // Find event by ID or slug
  let event;
  if (isSlug) {
    event = await Event.findOne({ slug: eventId });
  } else {
    event = await Event.findById(eventId);
  }

  // If event not found, return error
  if (!event) return next(new AppError("Event not found", 404));

  // Check if user is host
  if (event.host._id.toString() !== user._id.toString()) {
    return next(
      new AppError("You do not have permission to view this resource.", 403),
    );
  }

  // Pagination
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const skip = (page - 1) * limit;

  // Search and sort
  const search = (req.query.search as string) || "";
  const sortField = (req.query.sort as string) || "date"; // 'amount' or 'date'
  let sortObj: any = { createdAt: -1 };
  if (sortField === "amount") {
    sortObj = { amountPaid: -1 };
  }

  // Use aggregation to fetch guests with pagination
  const results = await Response.aggregate([
    // 1. Match responses for this event
    {
      $match: {
        event: event._id,
      },
    },
    // 2. Lookup user details
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "userProfile",
      },
    },
    // 3. Unwind user profile
    { $unwind: "$userProfile" },
    // 4. Search filter (if provided)
    ...(search
      ? [
          {
            $match: {
              $or: [
                { "userProfile.firstName": { $regex: search, $options: "i" } },
                { "userProfile.lastName": { $regex: search, $options: "i" } },
                {
                  $expr: {
                    $regexMatch: {
                      input: {
                        $concat: [
                          "$userProfile.firstName",
                          " ",
                          "$userProfile.lastName",
                        ],
                      },
                      regex: search,
                      options: "i",
                    },
                  },
                },
              ],
            },
          },
        ]
      : []),
    // 5. Project required fields
    {
      $project: {
        _id: 1,
        status: 1,
        amountPaid: 1,
        createdAt: 1,
        user: {
          _id: "$userProfile._id",
          firstName: "$userProfile.firstName",
          lastName: "$userProfile.lastName",
          email: "$userProfile.email",
          photo: "$userProfile.photo",
        },
      },
    },
    { $sort: sortObj },
    // 6. Facet for metadata and data
    {
      $facet: {
        metadata: [{ $count: "total" }],
        data: [{ $skip: skip }, { $limit: limit }],
      },
    },
  ]);

  const totalGuests = results[0]?.metadata[0]?.total || 0;
  const guests = results[0]?.data || [];

  // Count guests by status (going, maybe)
  let goingCount = 0;
  let maybeCount = 0;
  if (guests && guests.length > 0) {
    for (const g of guests) {
      if (g.status === "going") goingCount++;
      else if (g.status === "maybe") maybeCount++;
    }
  }

  // Format guest data
  const formattedGuests = guests.map((response: any) => {
    const user = formatGuestData(response.user);

    return {
      id: response._id,
      status: response.status,
      amountPaid: response.amountPaid || 0,
      date: response.createdAt,
      ...user,
    };
  });

  // Calculate total pages
  const totalPages = Math.ceil(totalGuests / limit);

  // Send response
  res.status(200).json({
    status: "success",
    results: formattedGuests.length,
    total: totalGuests,
    page,
    totalPages,
    data: formattedGuests,
    hasMore: page * limit < totalGuests,
    goingCount,
    maybeCount,
  });
});
