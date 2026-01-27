import { Model, Query, Document } from "mongoose";

export default class ApiFeatures<T extends Document = any> {
  // The Mongoose query object that will be built step-by-step
  query: Query<T[], T>;

  // The query string object from the request (usually req.query)
  queryString: { [key: string]: any };

  // Search field
  searchField?: string;

  // Store the filter conditions for count queries
  private filterConditions: { [key: string]: any } = {};

  constructor(
    Model: Model<T>,
    queryString: { [key: string]: any },
    searchField?: string,
  ) {
    this.query = Model.find({});
    this.queryString = queryString;
    if (searchField) this.searchField = searchField;
  }

  // Get the filter query for count operations
  getFilterQuery() {
    return this.filterConditions;
  }

  search() {
    // Check for search query
    if (this.queryString.search && this.searchField) {
      const search = this.queryString.search;
      
      // Escape special regex characters to prevent ReDoS
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const searchConditions = {
        [this.searchField]: { $regex: escapedSearch, $options: "i" },
      };

      // Add Search to query
      this.query = this.query.find(searchConditions);

      // Store for count
      this.filterConditions = { ...this.filterConditions, ...searchConditions };
    }
    return this;
  }

  filter() {
    // 1) Create a clean object
    const queryObj = { ...this.queryString };
    const excludedFields = ["page", "sort", "limit", "fields", "search"];
    excludedFields.forEach((el) => delete queryObj[el]);

    // 2) FIX: Manually handle the [gte] brackets if they aren't parsed
    let formattedQuery: { [key: string]: any } = {};

    Object.keys(queryObj).forEach((key) => {
      // This regex finds keys like "price[gte]" and extracts "price" and "gte"
      const match = key.match(/^(.+)\[(.+)\]$/);

      if (match) {
        const [_, field, operator] = match;
        if (!formattedQuery[field]) formattedQuery[field] = {};
        formattedQuery[field][`$${operator}`] = queryObj[key];
      } else {
        // Regular fields like difficulty=easy
        formattedQuery[key] = queryObj[key];
      }
    });

    // 3) Fallback for standard objects (if they are already nested)
    if (
      Object.keys(formattedQuery).length === 0 &&
      Object.keys(queryObj).length > 0
    ) {
      let queryStr = JSON.stringify(queryObj);
      queryStr = queryStr.replace(
        /\b(gte|gt|lte|lt)\b/g,
        (match) => `$${match}`,
      );
      formattedQuery = JSON.parse(queryStr);
    }

    this.query = this.query.find(formattedQuery);

    // Store for count
    this.filterConditions = { ...this.filterConditions, ...formattedQuery };

    return this;
  }

  sort() {
    if (this.queryString.sort) {
      // Convert comma-separated sort fields to space-separated for Mongoose
      const sortBy = this.queryString.sort.split(",").join(" ");
      this.query = this.query.sort(sortBy);
    } else {
      // Default sort: newest first
      this.query = this.query.sort("-createdAt");
    }
    return this;
  }

  limitFields() {
    if (this.queryString.fields) {
      const fields = this.queryString.fields.split(",").join(" ");
      this.query = this.query.select(fields);
    } else {
      // Exclude __v by default
      this.query = this.query.select("-__v");
    }
    return this;
  }

  paginate() {
    // Current page number
    const page = Number(this.queryString.page) || 1;

    // Items per page (max 100 to prevent abuse)
    const requestedLimit = Number(this.queryString.limit) || 100;
    const limit = Math.min(requestedLimit, 100);

    // How many results to skip
    const skip = (page - 1) * limit;

    this.query = this.query.skip(skip).limit(limit);
    return this;
  }
}
