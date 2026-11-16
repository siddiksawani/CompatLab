const assert = require("node:assert/strict");
const { createCanvas } = require("/study/node_modules/canvas");

const context = createCanvas(2, 1).getContext("2d");
context.fillStyle = "#ff0000";
context.fillRect(0, 0, 1, 1);
assert.deepEqual(Array.from(context.getImageData(0, 0, 2, 1).data), [255, 0, 0, 255, 0, 0, 0, 0]);
