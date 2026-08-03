const PHOTO_KEYS = ['front', 'left', 'right', 'closeup', 'neck', 'shelf_photos'];

export function sanitizeQuizAnswers(answers = {}) {
  const clean = { ...answers };
  clean.skinPhotosUploaded = ['front', 'left', 'right', 'closeup', 'neck'].some(key => Boolean(answers[key]));
  clean.shelfPhotosUploaded = Array.isArray(answers.shelf_photos) && answers.shelf_photos.length > 0;
  clean.skinPhotoCount = ['front', 'left', 'right', 'closeup', 'neck'].filter(key => Boolean(answers[key])).length;
  clean.shelfPhotoCount = Array.isArray(answers.shelf_photos) ? answers.shelf_photos.length : 0;
  PHOTO_KEYS.forEach(key => delete clean[key]);
  delete clean.skinScanToken;
  return clean;
}
