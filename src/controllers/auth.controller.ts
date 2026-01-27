import cookieConfig from "../config/cookie";
import User from "../models/user.model";
import UserToken from "../models/usertokens.model";
import AppError from "../utils/appError";
import catchAsync from "../utils/catchAsync";
import Email from "../utils/email";
import { deleteImage } from "../middlewares/image";
import {
  fetchRefreshToken,
  generateUserTokens,
  verifyRefreshToken,
} from "../utils/token";
import { validatePassword } from "../utils/validate";

// Verify front url
if (!process.env.FRONT_URL) {
  throw new Error("FRONT_URL not set in environment variables");
}

async function sendVerificationEmail(
  user: { _id: any; email: string; firstName: string },
  callback?: () => void,
) {
  try {
    // Create verify email token
    const token = await UserToken.createToken(
      user._id,
      "email-verification",
      10, // 10 minutes
    );
    // Send verification email
    await new Email({
      url: undefined,
      to: user.email,
    }).sendVerification(user.firstName, token);
  } catch (err: any) {
    console.error(err.message || err);
    // Delete token if email fails to send
    await UserToken.deleteUserTokens(user._id, "email-verification");

    // Execute callback if provided
    if (callback) callback();
  }
}

export const login = catchAsync(async (req, res, next) => {
  // Get fields
  const { email, password } = req.body;

  // Check if login credentials are empty
  if (!email || !password)
    return next(new AppError("Please provide login credentials", 400));

  // Fetch user
  const user = await User.findOne({ email }).select("+password +verified");

  // Check if user is verified
  if (user && !user.verified) {
    // Resend verification email
    await sendVerificationEmail(user);
  }

  // Check if user exists and password is correct
  if (!user || !(await user.verifyPassword(password, user.password)))
    return next(new AppError("Incorrect login details", 400));

  // Create data object
  const data = user.toObject();

  // Generate tokens
  const { refreshToken, accessToken } = generateUserTokens({
    id: data._id.toString(),
    role: data.role,
    accessTokenVersion: user.accessTokenVersion,
  });

  // Update user with refresh token
  user.refreshToken = refreshToken;
  await user.save();

  // Add refresh token to response
  res.cookie("refresh-token", refreshToken, cookieConfig);

  // Send response
  res.status(200).json({
    status: "success",
    message: "Login successful",
    accessToken,
  });
});

// Signup
export const signup = catchAsync(async (req, res, next) => {
  // Get fields
  const { password, firstName, lastName, email } = req.body;

  // Check if fields are empty
  if (!password || !email || !firstName || !lastName)
    return next(new AppError("All fields are required", 400));

  // Check if email exists in the database
  const existingUser = await User.findOne({ email });

  if (existingUser) return next(new AppError("Email already exists", 400));

  // Check if password is sufficient
  const error = validatePassword(password);
  if (error) return next(new AppError(error, 400));

  // Create user
  const newUser = await User.create({
    password,
    email,
    firstName,
    lastName,
  });

  // Send verification email
  await sendVerificationEmail(newUser);

  // Generate tokens
  const { refreshToken, accessToken } = generateUserTokens({
    id: newUser._id.toString(),
    role: newUser.role,
    accessTokenVersion: newUser.accessTokenVersion,
  });

  // Update user with refresh token
  newUser.refreshToken = refreshToken;
  await newUser.save();

  // Add refresh token to response
  if (process.env.NODE_ENV === "prod")
    res.cookie("refresh-token", refreshToken, cookieConfig);

  // Send response
  res.status(201).json({
    status: "success",
    message: "Please verify your email to complete signup",
    accessToken,
  });
});

// Logout
export const logout = catchAsync(async (req, res, _next) => {
  // Get refresh token
  const refreshToken = fetchRefreshToken(req);

  // Check for token and update user
  if (refreshToken) {
    try {
      const decodedToken = verifyRefreshToken(refreshToken);
      // Get user id
      const userID = decodedToken.id;
      // Update user
      await User.findByIdAndUpdate(userID, { $unset: { refreshToken: 1 } });
    } catch {
      // Token may be expired or tampered with
      console.warn("Invalid refresh token during logout:");
    }
  }
  const { maxAge, ...rest } = cookieConfig;
  // Clear cookie
  if (process.env.NODE_ENV === "prod") res.clearCookie("refresh-token", rest);
  // Send response
  res.sendStatus(204);
});

export const forgotPassword = catchAsync(async (req, res, next) => {
  // Fetch user
  const user = await User.findOne({ email: req.body.email });

  // Check if user exists
  if (!user) return next(new AppError("Email does not exist", 404));

  try {
    // Generate token
    const token = await UserToken.createToken(
      user._id,
      "password-reset",
      15, // 15 minutes
    );

    // Send email
    await new Email({
      url: `${process.env.FRONT_URL}/reset-password?token=${token}&email=${user.email}`,
      to: user.email,
    }).sendResetPassword(user.firstName);
  } catch (err: any) {
    // Delete token if email fails to send
    await UserToken.deleteUserTokens(user._id, "password-reset");
    // Return error
    return next(new AppError(err.message, 500));
  }

  // Send response
  res.status(200).json({
    status: "success",
    message: "Please check your email",
  });
});

export const resendOTP = catchAsync(async (req, res, next) => {
  // Fetch user
  const user = await User.findOne({ email: req.body.email }).select(
    "+verified",
  );

  // Check if user exists
  if (!user) return next(new AppError("Email does not exist", 404));

  // Check if user is already verified
  if (user.verified)
    return next(new AppError("Account is already verified", 400));

  // Resend verification email
  await sendVerificationEmail(user, () => {
    return next(
      new AppError("Failed to resend OTP. Please try again later.", 500),
    );
  });

  // Send response
  res.status(200).json({
    status: "success",
    message: "Please check your email",
  });
});

export const verifyAccount = catchAsync(async (req, res, next) => {
  // Validate input
  const { otp, email } = req.body;

  if (!otp || !email)
    return next(new AppError("OTP and email are required", 400));

  // Verify user token
  await UserToken.verifyToken(otp, "email-verification", email);

  // Fetch user using token
  const user = await User.findOne({ email });

  // Check if user exists
  if (!user) return next(new AppError("User not found", 404));

  // Update user as verified
  user.verified = true;
  await user.save({ validateBeforeSave: false });

  // Send welcome email
  try {
    await new Email({
      url: undefined,
      to: user.email,
    }).sendWelcome(user.firstName);
  } catch {
    console.warn("Failed to send email");
  }

  // Send response
  res.status(200).json({
    status: "success",
    message: "Account verified",
  });
});

// Reset password
export const resetPassword = catchAsync(async (req, res, next) => {
  // Get token and email from query
  const { token, email } = req.query as { token?: string; email?: string };
  if (!token || !email)
    return next(new AppError("Token and email are required", 400));
  // Verify token
  await UserToken.verifyToken(token, "password-reset", email);

  // Get fields
  const { newPassword } = req.body;

  // Check if field is empty
  if (!newPassword) return next(new AppError("New password is required", 400));

  // Fetch user
  const user = await User.findOne({ email }).select(
    "+password +accessTokenVersion",
  );

  // Check if user exists
  if (!user) return next(new AppError("User not found", 404));

  // Validate password
  const error = validatePassword(newPassword);
  if (error) return next(new AppError(error, 400));

  // Update fields
  user.password = newPassword;

  // Increment access token version to invalidate all existing tokens
  user.accessTokenVersion += 1;

  // Save user
  await user.save();

  // Delete used token
  await UserToken.deleteUserTokens(user._id, "password-reset");

  // Send response
  res.status(200).json({
    status: "success",
    message: "Password reset successful",
  });
});

export const refresh = catchAsync(async (req, res, next) => {
  // Get refresh token
  const refreshToken = fetchRefreshToken(req);

  // Check for refresh token
  if (!refreshToken)
    return next(new AppError("Unauthorized. Please log in.", 401));

  // Verify refresh token
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch (err) {
    return next(new AppError("Invalid or expired refresh token.", 403));
  }

  // Find user
  const user = await User.findById(decoded.id).select(
    "+refreshToken +accessTokenVersion",
  );
  if (!user || user.refreshToken !== refreshToken) {
    return next(new AppError("Forbidden. Invalid session.", 403));
  }
  // Generate new tokens
  const { refreshToken: newRefreshToken, accessToken: newAccessToken } =
    generateUserTokens({
      id: user._id.toString(),
      role: user.role,
      accessTokenVersion: user.accessTokenVersion,
    });

  // Save new refresh token
  user.refreshToken = newRefreshToken;
  await user.save({ validateBeforeSave: false });

  // Set new refresh token in cookie
  res.cookie("refresh-token", newRefreshToken, cookieConfig);

  // Send response
  res.status(200).json({
    status: "success",
    accessToken: newAccessToken,
  });
});

export const updateProfile = catchAsync(async (req, res, next) => {
  // Get old user data
  const oldUser = res.locals.user;

  // Get user ID from request
  const userID = res.locals.user.id;

  // Update user
  const updatedUser = await User.findByIdAndUpdate(userID, req.body, {
    new: true,
    runValidators: true,
  });

  if (!updatedUser) return next(new AppError("User not found", 404));

  // Delete old image if new one was uploaded
  if (req.body.photo && oldUser.photo?.public_id) {
    await deleteImage(oldUser.photo.public_id);
  }

  // Prepare user data for response
  const { photo, ...rest } = updatedUser.toObject();

  // Combine photo url with other user data
  const updatedUserData = { ...rest } as any;

  if (photo) updatedUserData.photo = photo.url;
  // Send response
  res.status(200).json({
    status: "success",
    data: updatedUserData,
  });
});

export const deactivateAccount = catchAsync(async (_req, res, next) => {
  // Get user ID from request
  const userID = res.locals.user.id;
  // Deactivate user
  const deletedUser = await User.findByIdAndUpdate(userID, { active: false });

  if (!deletedUser) return next(new AppError("User not found", 404));
  // Send response
  res.status(204).json({
    status: "success",
    data: null,
  });
});

export const getProfile = catchAsync(async (_req, res, next) => {
  // Get user ID from request
  const userID = res.locals.user.id;
  // Fetch user
  const user = await User.findById(userID);

  if (!user) return next(new AppError("User not found", 404));

  const { photo, ...userData } = user.toObject();

  const userProfile = { ...userData } as any;

  if (photo) userProfile.photo = photo.url;
  // Send response
  res.status(200).json({
    status: "success",
    data: userProfile,
  });
});

export const updatePassword = catchAsync(async (req, res, next) => {
  const userID = res.locals.user.id;

  // Get fields
  const { currentPassword, newPassword } = req.body;

  // Check if fields are empty
  if (!currentPassword || !newPassword)
    return next(new AppError("All fields are required", 400));

  // Get user from request
  const user = await User.findById(userID).select(
    "+password +accessTokenVersion",
  );

  // Check if user exists
  if (!user) return next(new AppError("User not found", 404));

  // Verify current password
  if (!(await user.verifyPassword(currentPassword, user.password)))
    return next(new AppError("Current password is incorrect", 400));

  if (currentPassword === newPassword)
    return next(
      new AppError("New password must be different from old password", 400),
    );

  // Validate new password
  const error = validatePassword(newPassword);
  if (error) return next(new AppError(error, 400));

  // Update password
  user.password = newPassword;

  // Increment access token version to invalidate all existing tokens
  user.accessTokenVersion += 1;

  await user.save();

  // Resend tokens
  const { refreshToken, accessToken } = generateUserTokens({
    id: user._id.toString(),
    role: user.role,
    accessTokenVersion: user.accessTokenVersion,
  });

  // Update user with refresh token
  user.refreshToken = refreshToken;
  await user.save();

  // Add refresh token to response
  res.cookie("refresh-token", refreshToken, cookieConfig);

  // Send response
  res.status(200).json({
    status: "success",
    message: "Password updated successfully",
    accessToken,
  });
});

export const googleAuth = catchAsync(async (req, res, next) => {
  // Get token from request
  const { token } = req.body;
  if (!token) return next(new AppError("Token is required", 400));

  // Verify token with Google (better security than just fetching user info)
  try {
    // Use Google's tokeninfo endpoint to verify the token
    const verifyResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${token}`,
    );

    if (!verifyResponse.ok)
      return next(new AppError("Invalid Google token", 401));

    const tokenInfo = await verifyResponse.json();

    // Verify token is for your app using client ID
    if (tokenInfo.aud !== process.env.GOOGLE_CLIENT_ID) {
      return next(new AppError("Token not intended for this application", 401));
    }

    // Fetch user info from Google (using v3 endpoint)
    const userInfoResponse = await fetch(
      `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${token}`,
    );

    if (!userInfoResponse.ok)
      return next(new AppError("Failed to fetch user information", 400));

    const payload = await userInfoResponse.json();

    // Verify email is verified by Google
    if (!payload.email_verified) {
      return next(
        new AppError("Please use a verified Google email address", 400),
      );
    }

    // Get user details
    const { email, given_name, family_name, picture, sub: googleId } = payload;

    // Validate required fields
    if (!email || !googleId) {
      return next(new AppError("Incomplete user information from Google", 400));
    }

    // Check if user exists
    let user = await User.findOne({ email }).select("+googleId");

    // If user exists but wasn't created via Google, prevent account takeover
    if (user && !user.googleId) {
      return next(
        new AppError(
          "An account with this email already exists. Please use email/password login",
          409,
        ),
      );
    }

    // If user exists but has different googleId (shouldn't happen, but safety check)
    if (user && user.googleId && user.googleId !== googleId) {
      return next(
        new AppError("This email is linked to a different Google account", 403),
      );
    }

    // If user does not exist, create new user
    if (!user) {
      user = await User.create({
        email,
        firstName: given_name || "Google",
        lastName: family_name || "User",
        googleId,
        photo: picture
          ? {
              url: picture,
            }
          : undefined,
        verified: true,
      });

      // Send welcome email
      try {
        await new Email({
          url: undefined,
          to: user.email,
        }).sendWelcome(user.firstName);
      } catch {
        console.warn("Failed to send welcome email");
      }
    } else {
      // Update existing user's photo if it changed
      if (picture && user.photo?.url !== picture) {
        user.photo = {
          url: picture,
        };
        await user.save({ validateBeforeSave: false });
      }
    }

    // Generate tokens
    const { refreshToken, accessToken } = generateUserTokens({
      id: user._id.toString(),
      role: user.role,
      accessTokenVersion: user.accessTokenVersion,
    });

    // Update user with refresh token
    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    // Add refresh token to response
    res.cookie("refresh-token", refreshToken, cookieConfig);

    // Send response
    res.status(200).json({
      status: "success",
      message: "Login successful",
      accessToken,
    });
  } catch (error: any) {
    console.error("Google Auth Error:", error.message);
    return next(new AppError("Authentication failed. Please try again.", 500));
  }
});
