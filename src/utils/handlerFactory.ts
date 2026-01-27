import catchAsync from "./catchAsync";
import AppError from "./appError";
import ApiFeatures from "./apiFeatures";
import { isValidObjectId, Model, Document } from "mongoose";

// Delete document
export const deleteOne = <T extends Document>(
  Model: Model<T>,
  field?: string,
) =>
  catchAsync(async (req, res, next) => {
    // Get model name
    const modelName = Model.modelName;

    // Get id
    const id = req.params.id;

    let doc;

    // Find and delete document
    if (isValidObjectId(id)) {
      doc = await Model.findByIdAndDelete(id);
    } else {
      if (field) doc = await Model.findOneAndDelete({ [field]: id });
    }

    // Return error if document doesnt exist
    if (!doc)
      return next(
        new AppError(`No ${modelName.toLowerCase()} found with that ID.`, 404),
      );

    // Send response
    res.status(204).json({
      status: "success",
      data: null,
    });
  });

// Create document
export const createOne = <T extends Document>(Model: Model<T>) =>
  catchAsync(async (req, res, _next) => {
    // Get model name
    const modelName = Model.modelName;

    // New document
    const newDoc = new Model(req.body);

    // Save document
    await newDoc.save();

    // Send response
    res.status(201).json({
      status: "success",
      message: `${modelName} created successfully`,
      data: newDoc,
    });
  });

// Find document
export const findOne = <T extends Document>(Model: Model<T>, field?: string) =>
  catchAsync(async (req, res, next) => {
    // Get model name
    const modelName = Model.modelName;

    // Get id
    const id = req.params.id;

    let doc;

    // Find document
    if (isValidObjectId(id)) {
      doc = await Model.findById(id);
    } else {
      if (field) doc = await Model.findOne({ [field]: id });
    }

    // Return error if document doesnt exist
    if (!doc)
      return next(
        new AppError(`No ${modelName.toLowerCase()} found with that ID`, 404),
      );

    // Send response
    res.status(200).json({
      status: "success",
      data: doc,
    });
  });

// Update document
export const updateOne = <T extends Document>(
  Model: Model<T>,
  field?: string,
) =>
  catchAsync(async (req, res, next) => {
    // Get model name
    const modelName = Model.modelName;

    // Get id
    const id = req.params.id;

    let doc;

    // Find and update document
    if (isValidObjectId(id)) {
      doc = await Model.findByIdAndUpdate(id, req.body, {
        new: true,
        runValidators: true,
      });
    } else {
      if (field)
        doc = await Model.findOneAndUpdate({ [field]: id }, req.body, {
          new: true,
          runValidators: true,
        });
    }
    // Check if document exists
    if (!doc)
      return next(
        new AppError(`No ${modelName.toLowerCase()} found with that ID`, 404),
      );

    // Send response
    res.status(200).json({
      status: "success",
      message: `${modelName} updated successfully`,
      data: doc,
    });
  });

// Find all documents
export const findAll = <T extends Document>(
  Model: Model<T>,
  searchField?: string,
) =>
  catchAsync(async (req, res, _next) => {
    // Construct query
    const features = new ApiFeatures<T>(Model, req.query, searchField)
      .search()
      .filter()
      .sort()
      .limitFields()
      .paginate();

    // Execute query
    const docs = await features.query;

    // Get total count for pagination
    const totalCount = await Model.countDocuments(features.getFilterQuery());

    // Get current page
    const page = Number(req.query.page) || 1;

    // Send response
    res.status(200).json({
      status: "success",
      results: docs.length,
      total: totalCount,
      page: page,
      data: docs,
    });
  });
