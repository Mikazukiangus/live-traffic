import type { RootOptions } from 'react-dom/client';
import { reportApplicationFailure } from '../../../shared/applicationDiagnostics';

export const recoveryRootOptions: RootOptions = {
  // Our boundaries own fixed diagnostics; React's default log includes raw error/stack details.
  onCaughtError: () => {},
  onUncaughtError: error => { reportApplicationFailure('app', error, 'react_uncaught'); },
  onRecoverableError: error => { reportApplicationFailure('app', error, 'react_recoverable'); },
};
