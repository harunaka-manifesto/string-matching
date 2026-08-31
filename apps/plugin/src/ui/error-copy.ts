import type { ErrorPayload } from '@ux-copy-sync/contracts';

export type ErrorAction = 'retry' | 'sign-in' | 'refresh' | 'change-source' | 'apply';

export type ErrorGuidance = {
  message: string;
  action?: ErrorAction;
  actionLabel?: string;
};

export function errorGuidance(error: ErrorPayload, hasReview: boolean): ErrorGuidance {
  switch (error.code) {
    case 'AUTH_REQUIRED':
    case 'AUTH_RECONNECT_REQUIRED':
      return {
        message: 'Your sign-in needs attention. Sign in again to continue.',
        action: 'sign-in',
        actionLabel: 'Sign in again',
      };
    case 'SHEET_URL_INVALID':
      return {
        message: 'That Sheet link is not a valid starting-cell link.',
        action: hasReview ? 'change-source' : undefined,
        actionLabel: 'Change Sheet',
      };
    case 'SHEET_ACCESS_DENIED':
      return {
        message: 'The Sheet could not be accessed. Check sharing, or choose another Sheet.',
        action: hasReview ? 'change-source' : 'retry',
        actionLabel: hasReview ? 'Change Sheet' : 'Retry',
      };
    case 'SHEET_NOT_FOUND':
    case 'SHEET_TAB_NOT_FOUND':
      return {
        message: 'The linked Sheet or tab was not found. Choose another Sheet.',
        action: hasReview ? 'change-source' : 'retry',
        actionLabel: hasReview ? 'Change Sheet' : 'Retry',
      };
    case 'SHEET_READ_FAILED':
      if (/no non-empty|empty sheet|no sheet copy/i.test(error.message))
        return {
          message:
            'No non-empty Sheet copy was found below that cell. Choose a different starting cell.',
          action: hasReview ? 'change-source' : 'retry',
          actionLabel: hasReview ? 'Change Sheet' : 'Retry',
        };
      return {
        message: 'The Sheet could not be read. Check your connection and try again.',
        action: hasReview ? 'refresh' : 'retry',
        actionLabel: hasReview ? 'Refresh review' : 'Retry',
      };
    case 'SHEET_RATE_LIMITED':
    case 'INTERNAL_ERROR':
    case 'INVALID_BACKEND_RESPONSE':
      return {
        message: 'The Sheet request failed. Check your connection and try again.',
        action: hasReview ? 'refresh' : 'retry',
        actionLabel: hasReview ? 'Refresh review' : 'Retry',
      };
    case 'INVALID_SELECTION_COUNT':
    case 'UNSUPPORTED_SELECTION':
    case 'NO_ELIGIBLE_TEXT':
    case 'TARGET_LIMIT_EXCEEDED':
      return { message: error.message };
    case 'SOURCE_STALE':
      return {
        message: 'The Sheet changed after this review. Refresh the review before applying.',
        action: 'refresh',
        actionLabel: 'Refresh review',
      };
    case 'PREVIEW_STALE':
      return {
        message: 'The design changed after this review. Refresh the review before applying.',
        action: 'refresh',
        actionLabel: 'Refresh review',
      };
    case 'LOCKED_LAYER':
    case 'FONT_LOAD_FAILED':
    case 'ROLLBACK_FAILED':
    case 'APPLY_FAILED':
      return { message: error.message, action: 'apply', actionLabel: 'Retry apply' };
    default:
      return {
        message: error.message,
        action: hasReview ? 'refresh' : 'retry',
        actionLabel: hasReview ? 'Refresh review' : 'Retry',
      };
  }
}
