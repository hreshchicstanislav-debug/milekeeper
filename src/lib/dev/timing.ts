/**
 * Development-only timing utilities for performance debugging
 * No-op in production builds
 */

// Track active timings to prevent duplicate labels
const activeTimings = new Map<string, number>();

/**
 * Time an async operation and log the duration (dev-only)
 * Uses performance.now() to avoid console.time label collisions
 * Generates unique labels to prevent any potential conflicts
 * @param label Label for the timing measurement
 * @param fn Async function to time
 * @returns Result of the function
 */
export async function time<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  if (process.env.NODE_ENV === 'production') {
    return fn();
  }

  // Generate unique label with timestamp and random suffix
  const uniqueLabel = `${label}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
  const start = performance.now();
  activeTimings.set(uniqueLabel, start);
  
  try {
    const result = await fn();
    const ms = performance.now() - start;
    activeTimings.delete(uniqueLabel);
    console.log(`Server  ${label}: ${ms.toFixed(2)}ms`);
    return result;
  } catch (error) {
    const ms = performance.now() - start;
    activeTimings.delete(uniqueLabel);
    console.log(`Server  ${label}: ${ms.toFixed(2)}ms (ERROR)`);
    throw error;
  }
}

