/**
 * @module APIHandler
 * Shared utilities for Next.js API route handlers.
 * Reduces boilerplate and ensures consistent error handling across routes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { HTTP_STATUS } from './constants';
import { logger } from '@claw/core/lib/logger';

/** Standard API error response shape. */
export interface ApiErrorResponse {
  error: string;
  details?: string;
}

/** Standard API success response shape. */
export type ApiSuccessResponse<T = Record<string, unknown>> = {
  success: true;
} & T;

/**
 * Wraps a Next.js handler with standard error handling and validation.
 * Eliminates the try/catch boilerplate duplicated across API routes.
 * Handles both GET and body-providing methods (POST, etc).
 *
 * @param handler - The business logic function. Receives parsed JSON body if present.
 * @returns A Next.js handler with consistent error handling.
 */
export function withApiHandler<T = unknown>(
  handler: (body: Record<string, unknown>, req: NextRequest) => Promise<T>
): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      let body: Record<string, unknown> = {};
      
      // Only attempt to parse body for non-GET methods
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        try {
          body = await req.json();
        } catch {
          // If no body provided or invalid JSON, default to empty object
          body = {};
        }
      }
      
      const result = await handler(body, req);
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof ApiError || (error && typeof error === 'object' && 'statusCode' in error)) {
        const apiError = error as { message?: string; details?: unknown; statusCode?: number };
        return NextResponse.json(
          { error: apiError.message, details: apiError.details },
          { status: apiError.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR }
        );
      }
      logger.error('API Error:', error);
      return NextResponse.json(
        {
          error: 'Internal Server Error',
          details: error instanceof Error ? error.message : String(error),
        },
        { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
      );
    }
  };
}

/**
 * Typed API error with HTTP status code.
 * Throw this from handlers to return a structured error response.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR,
    public details?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Validates that required fields are present in the request body.
 * Throws ApiError(400) if any are missing.
 *
 * @param body - The parsed request body.
 * @param requiredFields - List of required field names.
 * @throws {ApiError} If any required field is missing.
 */
export function requireFields(body: Record<string, unknown>, ...requiredFields: string[]): void {
  const missing = requiredFields.filter((f) => body[f] === undefined || body[f] === null);
  if (missing.length > 0) {
    throw new ApiError(
      `Missing required parameters: ${missing.join(', ')}`,
      HTTP_STATUS.BAD_REQUEST
    );
  }
}

/**
 * Validates that a value is one of the allowed enum values.
 * Throws ApiError(400) if not.
 *
 * @param value - The value to validate.
 * @param allowedValues - The set of allowed values.
 * @param fieldName - The field name for error messages.
 * @throws {ApiError} If the value is not in the allowed set.
 */
export function requireEnum<T extends string>(
  value: unknown,
  allowedValues: T[],
  fieldName: string
): asserts value is T {
  if (!allowedValues.includes(value as T)) {
    throw new ApiError(
      `Invalid ${fieldName}: ${value}. Must be one of ${allowedValues.join(', ')}`,
      HTTP_STATUS.BAD_REQUEST
    );
  }
}

/**
 * Validates a request body against a Zod schema.
 * Throws ApiError(400) with detailed validation errors if parsing fails.
 *
 * @param body - The raw request body.
 * @param schema - The Zod schema to validate against.
 * @returns The parsed and validated body with correct types.
 * @throws {ApiError} If validation fails.
 */
export function validateBody<T extends z.ZodType>(body: unknown, schema: T): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ApiError(`Validation failed: ${issues}`, HTTP_STATUS.BAD_REQUEST);
  }
  return result.data;
}
