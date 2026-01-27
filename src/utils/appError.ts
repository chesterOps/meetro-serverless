class AppError extends Error {
  // HTTP status code (e.g., 404, 500)
  statusCode: number;

  // Status string for easier identification (e.g., "fail" or "error")
  status: string;

  // Indicates if the error is expected (operational) vs a bug
  isOperational: boolean;

  // Validation or structured error details
  errors?: { [key: string]: any };

  constructor(
    message: string,
    statusCode: number,
    errors?: { [key: string]: any }
  ) {
    // Call parent Error constructor with message
    super(message);

    // Set status code
    this.statusCode = statusCode;

    // Set status based on type of error: client errors = "fail", server = "error"
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";

    // Flag to identify known/handled errors
    this.isOperational = true;

    // Include structured error info (e.g., validation errors)
    if (errors) this.errors = errors;

    // Capture stack trace excluding constructor
    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;
