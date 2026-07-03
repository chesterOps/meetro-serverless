import express from "express";
import upload from "../middlewares/multer";
import filter from "../middlewares/filter";
import {
  confirmAttendance,
  createEvent,
  deleteEvent,
  getEvent,
  getAllGuests,
  getMyEvents,
  updateEvent,
  getUserEventCounts,
} from "../controllers/event.controller";
import { isLoggedIn, protect } from "../middlewares/auth.middleware";
import { uploadEventImages } from "../middlewares/image";
import jsonBodyParse from "../middlewares/jsonParser";

const allowedFields = [
  "title",
  "description",
  "startDate",
  "endDate",
  "location",
  "image",
  "cohostImages",
  "meetingURL",
  "dressCode",
  "socials",
  "category",
  "cohosts",
  "chipInDetails",
  "isPrivate",
  "eventType",
  "font",
];

// Event router
const eventRouter = express.Router();

eventRouter
  .route("/")
  .post(
    protect,
    jsonBodyParse(
      "cohosts",
      "category",
      "dressCode",
      "location",
      "chipInDetails",
    ),
    upload.any(),
    uploadEventImages,
    createEvent,
  );

eventRouter.get("/my-events", protect, getMyEvents);

eventRouter.get("/event-counts", protect, getUserEventCounts);

eventRouter.post("/confirm-attendance", protect, confirmAttendance);

eventRouter.get("/:id/guests", protect, getAllGuests);

eventRouter.get("/:id/protected", protect, getEvent(true));

eventRouter
  .route("/:id")
  .delete(protect, deleteEvent)
  .get(isLoggedIn, getEvent())
  .patch(
    protect,
    jsonBodyParse(
      "cohosts",
      "category",
      "dressCode",
      "location",
      "chipInDetails",
    ),
    upload.any(),
    uploadEventImages,
    filter(...allowedFields),
    updateEvent,
  );

export default eventRouter;
