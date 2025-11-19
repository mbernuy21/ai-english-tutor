export const getApiKey = (): string => {
  // 1. Check standard process.env (Node/CRA/AI Studio)
  try {
    if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
      return process.env.API_KEY;
    }
  } catch (e) {
    // Ignore reference errors
  }

  // 2. Check Vite environment (import.meta.env)
  try {
    // @ts-ignore
    if (import.meta && import.meta.env && import.meta.env.VITE_API_KEY) {
      // @ts-ignore
      return import.meta.env.VITE_API_KEY;
    }
  } catch (e) {
    // Ignore errors if import.meta is not defined
  }

  // 3. Fallback: Check for other common prefixes if process exists
  try {
    if (typeof process !== 'undefined' && process.env) {
        if (process.env.REACT_APP_API_KEY) return process.env.REACT_APP_API_KEY;
        if (process.env.VITE_API_KEY) return process.env.VITE_API_KEY;
        if (process.env.NEXT_PUBLIC_API_KEY) return process.env.NEXT_PUBLIC_API_KEY;
    }
  } catch (e) {}

  return '';
};