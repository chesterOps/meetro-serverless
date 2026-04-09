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
} from "../controllers/event.controller";
import { isLoggedIn, protect } from "../middlewares/auth.middleware";
import { uploadImage } from "../middlewares/image";


const allowedFields = [
  "title",
  "description",
  "startDate",
  "endDate",
  "location",
  "image",
  "meetingURL",
  "dressCode",
  "socials",
  "category",
  "cohosts",
  "chipInDetails",
  "isPrivate",
  "eventType",
  "font"
];

// Event router
const eventRouter = express.Router();

eventRouter
  .route("/")
  .post(protect, upload.single("image"), uploadImage("image"), createEvent);

eventRouter.get("/my-events", protect, getMyEvents);

eventRouter.post("/confirm-attendance", protect, confirmAttendance);

eventRouter.get("/:id/guests", protect, getAllGuests);

eventRouter.get("/:id/protected", protect, getEvent(true));

eventRouter
  .route("/:id")
  .delete(protect, deleteEvent)
  .get(isLoggedIn, getEvent())
  .patch(
    protect,
    upload.single("image"),
    uploadImage("image"),
    filter(...allowedFields),
    updateEvent,
  );

export default eventRouter;
