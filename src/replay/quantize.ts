// Movement input as a signed byte per axis. Both the sim and the recorder see the dequantized value,
// so a live run and its replay see identical inputs.
/** @param {number} v */
export const quantize = (v) => Math.round(Math.max(-1, Math.min(1, v)) * 127) || 0; // `|| 0` turns -0 and NaN into 0
/** @param {number} q */
export const dequantize = (q) => q / 127;
