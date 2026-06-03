import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AnyZodObject, ZodTypeAny } from "zod";

interface ValidationSchema {
  body?: AnyZodObject | ZodTypeAny;
  query?: AnyZodObject | ZodTypeAny;
  params?: AnyZodObject | ZodTypeAny;
}

export const validateRequest = (schema: ValidationSchema): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const validated = {
      ...(schema.body ? { body: schema.body.parse(req.body) } : {}),
      ...(schema.query ? { query: schema.query.parse(req.query) } : {}),
      ...(schema.params ? { params: schema.params.parse(req.params) } : {})
    };

    req.validated = validated;
    next();
  };
};
