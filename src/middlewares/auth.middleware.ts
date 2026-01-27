import { NextFunction, Request, Response } from "express";
import { fetchAccessToken, verifyAccessToken } from "../utils/token";
import User from "../models/user.model";
import AppError from "../utils/appError";
import catchAsync from "../utils/catchAsync";

// Check if user is logged in
export const isLoggedIn = catchAsync(async (req, res, next) => {
  // Fetch token
  const token = fetchAccessToken(req);

  // Check for token
  if (!token) return next();

  // Verify access token
  let decodedToken;
  try {
    decodedToken = verifyAccessToken(token);
  } catch (err) {
    return next();
  }

  // Check if user exists
  const user = await User.findById(decodedToken.id);
  if (!user) return next();

  // Check if password was changed
  if (decodedToken.iat && user.changedPasswordAfter(decodedToken.iat))
    return next();

  // Set user on response
  res.locals.user = user;

  // Next middleware
  next();
});

// Protect route
export const protect = catchAsync(async (req, res, next) => {
  // Fetch token
  const token = fetchAccessToken(req);

  // Check if token exists
  if (!token) return next(new AppError("Please log in.", 401));

  // Verify access token
  let decodedToken;
  try {
    decodedToken = verifyAccessToken(token);
  } catch (err) {
    return next(new AppError("Invalid or expired access token.", 403));
  }

  // Fetch user
  const user = await User.findById(decodedToken.id).select(
    "+passwordChangedAt +accessTokenVersion",
  );

  // Check if user exists
  if (!user) return next(new AppError("User does not exist", 401));

  // Check if token version is valid
  if (decodedToken.version !== user.accessTokenVersion) {
    return next(
      new AppError("Session has been invalidated. Please log in again", 401),
    );
  }

  // Check if password was changed recently
  if (decodedToken.iat && user.changedPasswordAfter(decodedToken.iat))
    return next(
      new AppError("Password was changed recently. Please log in again", 401),
    );

  // Grant access to route
  res.locals.user = user;

  // Next middleware
  next();
});

// Authorize user
export const authorize =
  (...roles: Array<string>) =>
  (_req: Request, res: Response, next: NextFunction) => {
    // Check if user is authorized to perform action
    if (!roles.includes(res.locals.user.role))
      return next(
        new AppError(
          "You do not have permission to access this resource.",
          403,
        ),
      );

    // Next middleware
    next();
  };
