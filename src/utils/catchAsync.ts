import { Request, Response, NextFunction } from "express";

export default function catchAsync(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Call the async function and catch any errors
    fn(req, res, next).catch(next); // Forward error to Express error handler
  };
}
