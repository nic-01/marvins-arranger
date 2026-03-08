import { coreSongs, makeSong } from './songs';
import { songs1950s } from './catalog-1950s';
import { songs1960s } from './catalog-1960s';
import { songs1970s } from './catalog-1970s';
import { songs1980s } from './catalog-1980s';
import { songs1990s } from './catalog-1990s';
import { songs2000s } from './catalog-2000s';
import { songs2010s } from './catalog-2010s';
import { songs2020s } from './catalog-2020s';

const catalogSongs = [
  ...songs1950s,
  ...songs1960s,
  ...songs1970s,
  ...songs1980s,
  ...songs1990s,
  ...songs2000s,
  ...songs2010s,
  ...songs2020s,
].map(makeSong);

// Deduplicate by song id (core songs take priority)
const coreIds = new Set(coreSongs.map(s => s.id));
const newSongs = catalogSongs.filter(s => !coreIds.has(s.id));

export const allSongs = [...coreSongs, ...newSongs];
