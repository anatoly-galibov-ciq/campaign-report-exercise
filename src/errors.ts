// Errors the GraphQL layer turns into client-facing error codes.
export class AppError extends Error {
  readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'UPSTREAM_UNAVAILABLE';

  constructor(message: string, code: AppError['code'], options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 'NOT_FOUND');
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(message, 'FORBIDDEN');
  }
}

export class UpstreamError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'UPSTREAM_UNAVAILABLE', options);
  }
}
