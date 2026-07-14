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

const buildPublicId = (originalname: string) => {
  const parts = originalname.split(".");
  parts.pop(); // remove extension
  const sanitized = parts.join("").replace(/[^a-zA-Z0-9]/g, "_");
  return `${Date.now()}-${sanitized}`;
};

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
        const public_id = buildPublicId(file.originalname);

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

/**
 * Handles the main event image plus per-cohost images.
 *
 * Expects req.files to be an ARRAY (from upload.any()), not the
 * fieldname-keyed object you'd get from upload.fields().
 *
 * Event image file field: "image"
 * Cohost image file fields: "cohostImage_<index>" where <index> matches
 * the cohost's position in req.body.cohosts (which must already be a
 * parsed array by the time this runs).
 *
 * If a cohost already has a photo and no new file is uploaded for them,
 * the client should resend the existing { public_id, url } photo object
 * in req.body.cohosts[i].photo so it's preserved as-is.
 */
export const uploadEventImages =
  (isUpdate = false) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const files = (req.files as Express.Multer.File[]) || [];

      // --- Event image ---
      const imageFile = files.find((f) => f.fieldname === "image");

      if (imageFile) {
        try {
          const public_id = buildPublicId(imageFile.originalname);
          const result = (await uploadToCloudinary(
            imageFile.buffer,
            "meetro",
            public_id,
          )) as CloudinaryUploadResult;
          req.body.image = {
            public_id: result.public_id,
            url: result.secure_url,
          };
        } catch (error: any) {
          console.error("Event image upload failed:", error.message);
          delete req.body.image;
        }
      } else if (isUpdate) {
        // No new file uploaded on an UPDATE — never trust whatever the client
        // put in req.body.image. Deleting it means the controller's
        // Object.assign leaves the existing event.image untouched.
        delete req.body.image;
      } else if (typeof req.body.image === "string" && req.body.image.trim()) {
        // CREATE with no uploaded file, but a plain URL string was sent —
        // this is one of the default/template images. Normalize it into the
        // same { public_id, url } shape a real Cloudinary upload produces,
        // so the schema and downstream consumers (e.g. formatEventData) see
        // a consistent image object either way.
        req.body.image = {
          public_id: null,
          url: req.body.image.trim(),
        };
      } else if (!isUpdate) {
        // CREATE with no file and no usable string — don't let a bad/empty
        // value reach Event.create.
        delete req.body.image;
      }

      // --- Cohost images ---
      if (Array.isArray(req.body.cohosts)) {
        const cohostImageFiles = files.filter((f) =>
          /^cohostImage_\d+$/.test(f.fieldname),
        );

        await Promise.all(
          cohostImageFiles.map(async (file) => {
            const idx = parseInt(file.fieldname.split("_")[1], 10);
            if (Number.isNaN(idx) || !req.body.cohosts[idx]) return;

            try {
              const public_id = buildPublicId(file.originalname);
              const result = (await uploadToCloudinary(
                file.buffer,
                "meetro",
                public_id,
              )) as CloudinaryUploadResult;

              req.body.cohosts[idx].photo = {
                public_id: result.public_id,
                url: result.secure_url,
              };
            } catch (error: any) {
              console.error(
                `Cohost[${idx}] image upload failed:`,
                error.message,
              );
            }
          }),
        );
      }
    } catch (error: any) {
      console.error("Failed to process event images:", error.message);
    }

    next();
  };

export const deleteImage = async (publicId: string) => {
  try {
    // Delete image from cloudinary
    await cloudinary.api.delete_resources([publicId]);
  } catch (err) {
    console.log("Error deleting image:", err);
  }
};
