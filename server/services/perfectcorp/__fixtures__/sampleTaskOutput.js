// Raw shape of PerfectCorp's `data.results.output[]` for a single successful task, reverse-engineered
// from the normalized sample response walked through in the integration spec (§4.4): a Combination
// skin type with an Oily T-zone, moisture as the worst score, acne/texture clean.
module.exports = [
  { type: 'acne', raw_score: 93.98, ui_score: 91, mask_urls: ['https://cdn.example/acne.png'] },
  { type: 'pore', raw_score: 52.34, ui_score: 69, mask_urls: ['https://cdn.example/pore.png'] },
  { type: 'texture', raw_score: 88.17, ui_score: 84, mask_urls: ['https://cdn.example/texture.png'] },
  { type: 'redness', raw_score: 68.27, ui_score: 75, mask_urls: ['https://cdn.example/redness.png'] },
  { type: 'oiliness', raw_score: 63.45, ui_score: 73, mask_urls: ['https://cdn.example/oiliness.png'] },
  { type: 'moisture', raw_score: 48.94, ui_score: 70, mask_urls: ['https://cdn.example/moisture.png'] },
  { type: 'radiance', raw_score: 76.80, ui_score: 79, mask_urls: ['https://cdn.example/radiance.png'] },
  { type: 'wrinkle', raw_score: 74.79, ui_score: 74, mask_urls: ['https://cdn.example/wrinkle.png'] },
  { type: 'skin_type', region: 'whole', skin_type: 'Combination', mask_urls: ['https://cdn.example/st_whole.png'] },
  { type: 'skin_type', region: 't_zone', skin_type: 'Oily', mask_urls: ['https://cdn.example/st_tzone.png'] },
  { type: 'skin_type', region: 'u_zone', skin_type: 'Normal', mask_urls: ['https://cdn.example/st_uzone.png'] },
  { type: 'all', score: 75.93, ui_score: 76 },
  { type: 'skin_age', score: 37 },
  { type: 'resize_image', mask_urls: ['https://cdn.example/resized.jpg'] },
  { type: 'some_future_concern', raw_score: 10, ui_score: 20 },
];
