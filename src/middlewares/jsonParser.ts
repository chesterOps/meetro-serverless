import { NextFunction, Request, Response } from "express";

export default function jsonBodyParse(...fields: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    fields.forEach((field) => {
      if (typeof req.body[field] === "string") {
        req.body[field] = JSON.parse(req.body[field]);
      }
    });
    next();
  };
}
