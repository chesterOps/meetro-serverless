import serverless from "serverless-http";
import app from "./app";
import { connectToDatabase } from "./config/db";

const serverlessApp = serverless(app);

export const handler = async (event: any, context: any) => {
  // 1. Prevent Lambda from hanging on open DB connections
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    await connectToDatabase();
  } catch (err) {
    console.error("DB Connection Failed:", err);
    return { statusCode: 500, body: "Database connection error" };
  }
  // 3. Proxy the request to Express
  return await serverlessApp(event, context);
};
