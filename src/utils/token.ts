import jwt, { JwtPayload } from "jsonwebtoken";
import { Request } from "express";

export interface TokenPayload extends JwtPayload {
  id: string;
  role: string;
  version?: number;
}

export const REFRESH_TOKEN_COOKIE = "refresh-token";

// Verify access token safely
if (!process.env.ACCESS_TOKEN_SECRET || !process.env.REFRESH_TOKEN_SECRET) {
  throw new Error(
    "ACCESS_TOKEN_SECRET OR REFRESH_TOKEN_SECRET not set in environment variables",
  );
}

// Generate user tokens
export const generateUserTokens = (data: {
  id: string;
  role: string;
  accessTokenVersion?: number;
}): { accessToken: string; refreshToken: string } => {
  const accessToken = jwt.sign(
    {
      id: data.id,
      role: data.role,
      version: data.accessTokenVersion || 0,
    },
    process.env.ACCESS_TOKEN_SECRET!,
    {
      expiresIn: "15m",
    },
  );
  const refreshToken = jwt.sign(
    {
      id: data.id,
      role: data.role,
    },
    process.env.REFRESH_TOKEN_SECRET!,
    {
      expiresIn: "24h",
    },
  );
  return { accessToken, refreshToken };
};

// Fetch access token
export const fetchAccessToken = (req: Request): string | undefined => {
  // Authorization
  const authorization = req.headers.authorization;

  // Check for token in authorization header
  if (authorization && authorization.startsWith("Bearer"))
    return authorization.split(" ")[1];
};

// Fetch refresh token
export const fetchRefreshToken = (req: Request): string | undefined =>
  req.cookies[REFRESH_TOKEN_COOKIE];

// Verify access token
export const verifyAccessToken = (token: string) =>
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!) as TokenPayload;
// Verify refresh token
export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, process.env.REFRESH_TOKEN_SECRET!) as TokenPayload;
