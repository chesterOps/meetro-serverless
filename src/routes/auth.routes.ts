import express from "express";
import upload from "../middlewares/multer";
import filter from "../middlewares/filter";
import {
  forgotPassword,
  login,
  logout,
  verifyAccount,
  refresh,
  resetPassword,
  updatePassword,
  deactivateAccount,
  signup,
  updateProfile,
  getProfile,
  googleAuth,
  resendOTP,
} from "../controllers/auth.controller";
import { protect } from "../middlewares/auth.middleware";
import { uploadImage } from "../middlewares/image";

const allowedFields = [
  "firstName",
  "lastName",
  "email",
  "address",
  "bio",
  "interests",
  "photo",
  "socials",
];

// Auth router
const authRouter = express.Router();

authRouter.post("/forgot-password", forgotPassword);

authRouter.patch("/reset-password", resetPassword);

authRouter.delete("/delete-account", protect, deactivateAccount);

authRouter.post("/resend-otp", resendOTP);

authRouter.post("/verify-account", verifyAccount);

authRouter.post("/login", login);

authRouter.post("/logout", logout);

authRouter.post("/signup", signup);

authRouter.patch("/update-password", protect, updatePassword);

authRouter.post("/refresh-token", refresh);

authRouter.post("/google-auth", googleAuth);

authRouter.patch(
  "/update-profile",
  protect,
  upload.single("photo"),
  uploadImage("photo"),
  filter(...allowedFields),
  updateProfile,
);

authRouter.get("/get-profile", protect, getProfile);

export default authRouter;
