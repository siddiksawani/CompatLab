const assert = require("node:assert/strict");
const sharp = require("/study/node_modules/sharp");

async function check() {
  const input = Buffer.from([255, 0, 0]);
  const { data, info } = await sharp(input, { raw: { width: 1, height: 1, channels: 3 } })
    .resize(2, 2)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 2);
  assert.equal(info.height, 2);
  assert.deepEqual(data, Buffer.from([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]));
}

module.exports = check;
