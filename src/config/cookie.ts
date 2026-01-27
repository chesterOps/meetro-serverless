const cookieConfig: {
  httpOnly: boolean;
  maxAge: number;
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
} = {
  httpOnly: true,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in seconds
  sameSite: process.env.NODE_ENV === "prod" ? "none" : "lax",
  secure: process.env.NODE_ENV === "prod",
};

export default cookieConfig;
