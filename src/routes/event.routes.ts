import express from "express";
import {
  confirmAttendance,
  createEvent,
  deleteEvent,
  getEvent,
  getMyEvents,
  updateEvent,
} from "../controllers/event.controller";
import { isLoggedIn, protect } from "../middlewares/auth.middleware";
import { uploadImage } from "../middlewares/image";
import upload from "../middlewares/multer";
import filter from "../middlewares/filter";

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
];

// Event router
const eventRouter = express.Router();

eventRouter
  .route("/")
  .post(protect, upload.single("image"), uploadImage("image"), createEvent);

eventRouter.get("/my-events", protect, getMyEvents);

eventRouter.post("/confirm-attendance", protect, confirmAttendance);

eventRouter
  .route("/:id")
  .delete(protect, deleteEvent)
  .get(isLoggedIn, getEvent)
  .patch(
    protect,
    upload.single("image"),
    uploadImage("image"),
    filter(...allowedFields),
    updateEvent
  );

export default eventRouter;
