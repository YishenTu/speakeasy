export interface BusyState {
  isBusy: () => boolean;
  setBusy: (busy: boolean) => void;
}

export async function runWithBusyState<T>(
  busyState: BusyState,
  action: () => Promise<T>,
): Promise<T> {
  busyState.setBusy(true);
  try {
    return await action();
  } finally {
    busyState.setBusy(false);
  }
}

export async function runWhenIdle<T>(
  busyState: BusyState,
  action: () => Promise<T>,
): Promise<T | undefined> {
  if (busyState.isBusy()) {
    return undefined;
  }

  return runWithBusyState(busyState, action);
}
