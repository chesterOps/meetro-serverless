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
    const file =
      req.file ||
      (req.files && Array.isArray((req.files as any)[field])
        ? (req.files as any)[field][0]
        : undefined);

    // Check for single image file
    if (file) {
      try {
        // Split file name by "." to remove extension
        const fileName = file.originalname.split(".");
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
          file.buffer,
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
    } else {
      if (req.body[field]) {
        req.body[field] = {
          url: req.body[field],
        };
      }
    }

    // Next middleware
    next();
  };

export const uploadCohostImages = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    if (typeof req.body.cohosts === "string") {
      req.body.cohosts = JSON.parse(req.body.cohosts);
    }

    const cohostFiles = (req.files as any)?.cohostImages;
    if (!Array.isArray(cohostFiles) || cohostFiles.length === 0) {
      return next();
    }

    if (!Array.isArray(req.body.cohosts)) {
      return next();
    }

    const uploadedPhotos: string[] = [];
    for (const file of cohostFiles) {
      try {
        const fileName = file.originalname.split(".");
        fileName.pop();
        const sanitizedName = fileName.join("").replace(/[^a-zA-Z0-9]/g, "_");
        const timestamp = Date.now();
        const public_id = `${timestamp}-${sanitizedName}`;
        const result = (await uploadToCloudinary(
          file.buffer,
          "meetro",
          public_id,
        )) as CloudinaryUploadResult;
        uploadedPhotos.push(result.secure_url);
      } catch (error: any) {
        console.error("Cohost image upload failed:", error.message);
        uploadedPhotos.push("");
      }
    }

    req.body.cohosts = req.body.cohosts.map((cohost: any, idx: number) => ({
      ...cohost,
      photo: cohost.photo ?? uploadedPhotos[idx] ?? cohost.photo,
    }));
  } catch (error: any) {
    console.error("Failed to process cohost images:", error.message);
  }

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
