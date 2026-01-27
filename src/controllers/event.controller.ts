import { isValidObjectId } from "mongoose";
import { deleteImage } from "../middlewares/image";
import Donation from "../models/donation.model";
import Event from "../models/event.model";
import Response from "../models/response.model";
import User from "../models/user.model";
import { paystack } from "../paystack/paystackSettlementPoller";
import AppError from "../utils/appError";
import catchAsync from "../utils/catchAsync";
import Email from "../utils/email";
import { buildICS, formatDate, formatTime, toBase64 } from "../utils/helpers";

// Helper function to format user data for guest display
const formatGuestData = (user: any) => {
  const data: { [key: string]: any } = {
    name: `${user.firstName} ${user.lastName}`,
    email: user.email,
  };
  if (user.photo) data.photo = user.photo.url;
  return data;
};

// Helper function to format event data for response
const formatEventData = (event: any, options?: { skipCreator?: boolean }) => {
  const eventObj = event.toObject ? event.toObject() : { ...event };

  // Extract and format image
  if (eventObj.image) {
    eventObj.image = eventObj.image.url;
  }

  // Delete creator field unless explicitly kept
  if (!options?.skipCreator) {
    delete eventObj.creator;
  }

  // Delete updateCount field
  delete eventObj.updateCount;

  // Format guests to include user details
  if (eventObj.guests && eventObj.guests.length > 0) {
    eventObj.guests = eventObj.guests.map((guest: any) => {
      return formatGuestData(guest.user);
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

  // Check if user is creator or admin
  if (
    event.creator._id.toString() !== user._id.toString() &&
    user.role !== "admin"
  )
    return next(
      new AppError("You do not have permission to delete this event.", 403),
    );

  // Check if user is creator
  if (event.creator._id.toString() === user._id.toString()) {
    // Check for active donations
    const donationCount = await Donation.getTotalDonations(event._id);
    if (donationCount && donationCount.totalDonations > 0) {
      return next(
        new AppError(
          "Cannot delete event with active donations. Please contact support.",
          403,
        ),
      );
    }

    // Check if event that has started
    if (new Date(event.startDate) <= new Date()) {
      return next(
        new AppError(
          "Cannot delete event that has already started. Please contact support.",
          403,
        ),
      );
    }
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
  // Set user as creator
  const userId = res.locals.user._id;
  req.body.creator = userId;

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

  // Check if host is on the platform and replace with user details
  const hostEmail = req.body.host.email;
  const hostUser = await User.findOne({ email: hostEmail });
  if (hostUser) {
    req.body.host = {
      name: `${hostUser.firstName} ${hostUser.lastName}`,
      email: hostUser.email,
    };
    if (hostUser.photo) req.body.host.photo = hostUser.photo.url;
  }

  // Process cohosts
  if (!req.body.cohosts) req.body.cohosts = [];

  // Check if cohosts are on the platform and replace with user details
  const cohostUsers = await User.find({
    email: { $in: req.body.cohosts.map((cohost: any) => cohost.email) },
  });

  if (cohostUsers && cohostUsers.length > 0) {
    req.body.cohosts = req.body.cohosts.map((cohost: any) => {
      const matchedUser = cohostUsers.find(
        (user) => user.email === cohost.email,
      );
      if (matchedUser) {
        return formatGuestData(matchedUser);
      }
      return cohost;
    });
  }

  // Create event
  const event = await Event.create(req.body);

  // Collect all users who should be marked as "going"
  const usersToMarkGoing = new Set<string>();
  usersToMarkGoing.add(userId.toString()); // Creator
  if (hostUser) usersToMarkGoing.add(hostUser._id.toString()); // Host
  if (cohostUsers && cohostUsers.length > 0) {
    cohostUsers.forEach((cohost) =>
      usersToMarkGoing.add(cohost._id.toString()),
    );
  }

  // Create "going" responses for all organizers
  const responsePromises = Array.from(usersToMarkGoing).map((user) =>
    Response.create({
      event: event._id,
      user,
      status: "going",
    }),
  );

  // Await all response creations
  const responses = await Promise.all(responsePromises);

  // Populate user details in responses
  const responsesData = responses.map(
    async (response) =>
      await response.populate("user", "firstName lastName email photo"),
  );

  // Format guests to include user details
  const guests = (await Promise.all(responsesData)).map((response) => {
    const user = response.user as { [key: string]: any };
    return formatGuestData(user);
  });

  // Prepare response data
  const eventData = formatEventData(event);
  eventData.userRole = "creator";
  eventData.userResponse = "going";
  eventData.guests = guests;

  // Send response
  res.status(201).json({
    status: "success",
    data: eventData,
  });
});

export const getEvent = catchAsync(async (req, res, next) => {
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
    event = await Event.findOne({ slug: eventId });
  } else {
    event = await Event.findById(eventId);
  }
  // If event not found, return error
  if (!event) return next(new AppError("Event not found", 404));

  // Format event data
  const eventData = formatEventData(event);

  // Check if user exists
  if (user) {
    // Check if user has management permissions
    const isCreator = event.creator._id.toString() === user._id.toString();
    const isHost = event.host.email === user.email;
    const isCohost = event.cohosts.some(
      (cohost: any) => cohost.email === user.email,
    );
    if (isCreator) eventData.userRole = "creator";
    else if (isHost) eventData.userRole = "host";
    else if (isCohost) eventData.userRole = "cohost";
    else eventData.userRole = "guest";

    // Find user's response to the event
    const userResponse = await Response.findOne({
      user: user._id,
      event: event._id,
    });
    // If user has responded, add response status
    if (userResponse) {
      eventData.userResponse = userResponse.status;
    }
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
    dateFilter = { endDate: { $lt: now } };
  }

  // Use aggregation for efficient pagination
  const results = await Event.aggregate([
    {
      $facet: {
        // Created events pipeline
        createdEvents: [
          { $match: { creator: user._id, ...dateFilter } },
          {
            $addFields: {
              userRole: "creator",
              userResponse: "going",
            },
          },
        ],
        // Guest events pipeline
        guestEvents: [
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
              as: "userResponses",
            },
          },
          {
            $match: {
              "userResponses.0": { $exists: true },
              creator: { $ne: user._id },
              ...dateFilter,
            },
          },
          {
            $addFields: {
              userResponse: { $arrayElemAt: ["$userResponses.status", 0] },
              userRole: {
                $cond: [
                  { $eq: ["$host.email", user.email] },
                  "host",
                  {
                    $cond: [
                      { $in: [user.email, "$cohosts.email"] },
                      "cohost",
                      "guest",
                    ],
                  },
                ],
              },
            },
          },
          { $project: { userResponses: 0 } },
        ],
      },
    },
    // Combine both arrays
    {
      $project: {
        allEvents: { $concatArrays: ["$createdEvents", "$guestEvents"] },
      },
    },
    { $unwind: "$allEvents" },
    { $replaceRoot: { newRoot: "$allEvents" } },
    // Sort by creation date
    { $sort: { createdAt: -1 } },
    // Pagination facet
    {
      $facet: {
        metadata: [{ $count: "total" }],
        data: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              slug: 1,
              title: 1,
              startDate: 1,
              endDate: 1,
              eventType: 1,
              image: 1,
              category: 1,
              host: 1,
              cohosts: 1,
              guests: 1,
              createdAt: 1,
              updatedAt: 1,
              location: 1,
              userRole: 1,
              userResponse: 1,
            },
          },
        ],
      },
    },
  ]);

  const totalEvents = results[0]?.metadata[0]?.total || 0;
  const events = results[0]?.data || [];

  // Format events using helper
  const formattedEvents = events.map((event: any) => formatEventData(event));

  // Send response
  res.status(200).json({
    status: "success",
    results: formattedEvents.length,
    total: totalEvents,
    page,
    data: formattedEvents,
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

  // Check if user has permission to update (creator, cohost, or admin)
  const isCreator = event.creator._id.toString() === user._id.toString();
  const isHost = event.host.email === user.email;
  const isCohost = event.cohosts.some(
    (cohost: any) => cohost.email === user.email,
  );

  const isAdmin = user.role === "admin";

  if (!isCreator && !isCohost && !isAdmin && !isHost) {
    return next(
      new AppError("You do not have permission to update this event.", 403),
    );
  }

  // Check updateCount limit (skip for admins)
  if (!isAdmin && event.updateCount >= 3) {
    return next(
      new AppError(
        "You have reached the maximum number of updates for this event.",
        403,
      ),
    );
  }

  // Check for new image and delete old image if necessary
  if (req.body.image && event.image && event.image.public_id)
    await deleteImage(event.image.public_id);

  // Update event with new data
  Object.assign(event, req.body);

  // Adjust event type based on location and meetingURL
  if (req.body.meetingURL) {
    event.eventType = "online";
    event.location = undefined;
  }

  if (req.body.location) {
    event.eventType = "offline";
    event.meetingURL = undefined;
  }

  // Increment updateCount if not admin
  if (!isAdmin) event.updateCount += 1;

  // Save updated event
  await event.save({
    validateBeforeSave: false,
  });

  // Prepare response data
  const eventData = formatEventData(event);

  // Determine user role
  if (isCreator) eventData.userRole = "creator";
  else if (isHost) eventData.userRole = "host";
  else if (isCohost) eventData.userRole = "cohost";

  // Find user's response to the event
  const userResponse = await Response.findOne({
    user: user._id,
    event: event._id,
  });

  // If user has responded, add response status
  if (userResponse) eventData.userResponse = userResponse.status;

  // Send response
  res.status(200).json({
    status: "success",
    data: eventData,
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

  // Check if user is the creator
  if (event.creator._id.toString() === user._id.toString()) {
    return next(
      new AppError(
        "Creator cannot confirm attendance to their own event.",
        400,
      ),
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
        if (event.location.country) location.push(`${event.location.country}`);
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

  // Send response
  res.status(200).json({
    status: "success",
    message: `Attendance marked as ${responseStatus}`,
  });
});
