import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGO_URL!;

// Cache the connection across Lambda executions
let isConnected: number = 0;

export const connectToDatabase = async () => {
  if (isConnected) {
    console.log("=> Using existing database connection");
    return;
  }

  console.log("=> Creating new database connection");
  const db = await mongoose.connect(MONGODB_URI, {
    // Optimization for Serverless
    serverSelectionTimeoutMS: 10000, // 10 seconds - good balance for serverless
    bufferCommands: false, // Fail fast if connection is lost
  });

  isConnected = db.connections[0].readyState;
};
