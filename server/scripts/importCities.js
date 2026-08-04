#!/usr/bin/env node

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mongoose = require('mongoose');

const DEFAULT_FILE = path.resolve(__dirname, 'data/cities15000.txt');
const BATCH_SIZE = 2000;

function parseCityRow(line) {
  const columns = line.split('\t');
  if (columns.length < 19 || !columns[7]?.startsWith('PPL')) return null;

  const lat = Number(columns[4]);
  const lng = Number(columns[5]);
  const population = Number(columns[14]) || 0;
  const name = columns[2]?.trim();
  const displayName = columns[1]?.trim();
  const country = columns[8]?.trim().toUpperCase();
  const timezone = columns[17]?.trim();

  if (!name || !displayName || !/^[A-Z]{2}$/.test(country) || !timezone
    || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { name, displayName, country, lat, lng, timezone, population };
}

async function importCities(filePath = process.argv[2] || DEFAULT_FILE) {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is required');
  if (!fs.existsSync(filePath)) {
    throw new Error(`GeoNames data file not found: ${filePath}\nDownload and unzip cities15000.txt into server/scripts/data/.`);
  }

  await mongoose.connect(mongoUri, { autoIndex: false });
  const collection = mongoose.connection.collection('cities');

  try {
    await collection.drop();
  } catch (err) {
    if (err.code !== 26 && err.codeName !== 'NamespaceNotFound') throw err;
  }

  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let batch = [];
  let imported = 0;
  let skipped = 0;

  for await (const line of lines) {
    const city = parseCityRow(line);
    if (!city) {
      skipped += 1;
      continue;
    }
    batch.push(city);
    if (batch.length >= BATCH_SIZE) {
      await collection.insertMany(batch, { ordered: false });
      imported += batch.length;
      batch = [];
      if (imported % 20000 === 0) console.log(`Imported ${imported.toLocaleString()} cities...`);
    }
  }

  if (batch.length) {
    await collection.insertMany(batch, { ordered: false });
    imported += batch.length;
  }

  await collection.createIndexes([
    { key: { name: 'text', displayName: 'text' }, name: 'city_text' },
    { key: { name: 1 }, name: 'city_name_prefix' },
    { key: { displayName: 1 }, name: 'city_display_name_prefix' },
    { key: { country: 1, population: -1 }, name: 'city_country_population' },
  ]);

  console.log(`City import complete: ${imported.toLocaleString()} imported, ${skipped.toLocaleString()} skipped.`);
  return { imported, skipped };
}

if (require.main === module) {
  importCities()
    .catch(err => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { importCities, parseCityRow };
