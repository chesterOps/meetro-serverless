import cloudinary from "../config/cloudinary";
import streamifier from "streamifier";
import { Response, Request, NextFunction } from "express";

interface CloudinaryUploadResult {
  secure_url: string;
  public_id: string;
}

const uploadToCloudinary = (
  buffer: Buffer,
  folder = "meetro",
  public_id: string,
) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id, resource_type: "auto" },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });

export const uploadImage =
  (field: string) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    // Check for single image file
    if (req.file) {
      try {
        // Split file name by "." to remove extension
        const fileName = req.file.originalname.split(".");
        // Remove the last part (extension)
        fileName.pop();
        // Sanitize filename - remove special characters
        const sanitizedName = fileName.join("").replace(/[^a-zA-Z0-9]/g, "_");
        // Create timestamp
        const timestamp = Date.now();
        // Create public_id
        const public_id = `${timestamp}-${sanitizedName}`;

        // Upload to Cloudinary
        const result = (await uploadToCloudinary(
          req.file.buffer,
          "meetro",
          public_id,
        )) as CloudinaryUploadResult;

        const image = {
          public_id: result.public_id,
          url: result.secure_url,
        };

        // Attach to request body
        req.body[field] = image;
      } catch (error: any) {
        // Log error but don't block the request
        console.error(
          `Image upload failed for field "${field}":`,
          error.message,
        );
      }
    }

    // Next middleware
    next();
  };

export const deleteImage = async (image: string) => {
  try {
    // Delete image from cloudinary
    await cloudinary.api.delete_resources([image]);
  } catch (err) {
    console.log("Error deleting image:", err);
  }
};
