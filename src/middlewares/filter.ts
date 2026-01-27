import { Request, Response, NextFunction } from "express";

export default function filter(...fieldsToAllow: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    // Create new object with only allowed fields
    const newBody: Record<string, any> = {};

    // Only keep allowed fields
    fieldsToAllow.forEach((field) => {
      if (field in req.body) {
        newBody[field] = req.body[field];
      }
    });

    // Replace request body
    req.body = newBody;

    next();
  };
}
