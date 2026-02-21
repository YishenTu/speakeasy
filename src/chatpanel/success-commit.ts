export async function runWithSuccessCommit<T>(
  operation: () => Promise<T>,
  onSuccess: () => void,
): Promise<T> {
  const result = await operation();
  onSuccess();
  return result;
}
