/**
 * Retry a function with temperature decay.
 * @param {function} fn - async function that receives { temperature }
 * @param {number[]} temperatures - temperature schedule (e.g. [0.8, 0.6, 0.4])
 * @param {string} label - label for logging
 * @returns {Promise<object>} result from fn
 */
export async function retryWithDecay(fn, temperatures, label) {
  let lastError;
  for (let i = 0; i < temperatures.length; i++) {
    const t = temperatures[i];
    try {
      const result = await fn({ temperature: t });
      if (i > 0) {
        console.log(
          JSON.stringify({
            step: label,
            attempt: i + 1,
            temperature: t,
            status: "success",
          })
        );
      }
      return result;
    } catch (err) {
      lastError = err;
      console.error(
        JSON.stringify({
          step: label,
          attempt: i + 1,
          temperature: t,
          status: "failed",
          error: err.message,
        })
      );
    }
  }
  throw new Error(
    `${label}: all ${temperatures.length} attempts failed. Last error: ${lastError.message}`
  );
}
