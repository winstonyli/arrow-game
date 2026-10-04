// Movement input as a signed byte per axis. Both the sim and the recorder see the dequantized value,
// so a live run and its replay see identical inputs.
export const quantize = (v: number): number => Math.round(Math.max(-1, Math.min(1, v)) * 127) || 0; // `|| 0` turns -0 and NaN into 0
export const dequantize = (q: number): number => q / 127;
