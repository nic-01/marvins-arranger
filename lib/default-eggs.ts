import type { EasterEgg } from '@/lib/types';

// Default Easter eggs from the brief — shared between server and client
export const DEFAULT_EGGS: Omit<EasterEgg, 'id'>[] = [
  { source_song: 'Johnny B. Goode (Chuck Berry)', source_decade: '1950s', host_decade: '2000s', difficulty: 'Hard', notes: 'White Stripes-style garage rock tone next to Seven Nation Army' },
  { source_song: 'Yesterday (The Beatles)', source_decade: '1960s', host_decade: '1930s', difficulty: 'Very Hard', notes: 'Piano, brushed drums, muted trumpet — essentially a 1930s music hall song' },
  { source_song: 'Dancing Queen (ABBA)', source_decade: '1970s', host_decade: '1990s', difficulty: 'Medium', notes: 'Piano next to Bitter Sweet Symphony — ABBA harmonic language close to Britpop' },
  { source_song: 'Every Breath You Take (The Police)', source_decade: '1980s', host_decade: '2010s', difficulty: 'Hard', notes: 'Minimalist guitar next to Shallow — sounds like a lost The xx track' },
  { source_song: 'Come As You Are (Nirvana)', source_decade: '1990s', host_decade: '1950s', difficulty: 'Very Hard', notes: 'Full stop. Tempo halves. Four singers in close doo-wop harmony' },
  { source_song: 'Rehab (Amy Winehouse)', source_decade: '2000s', host_decade: '1960s', difficulty: 'Easy', notes: 'Flows directly out of Respect — same key. Soul DNA hiding in plain sight' },
  { source_song: 'Get Lucky (Daft Punk)', source_decade: '2010s', host_decade: '1970s', difficulty: 'Medium', notes: 'Keyboard and bass in Chic-style groove. Takes ~16 bars for the penny to drop' },
  { source_song: 'As It Was (Harry Styles)', source_decade: '2020s', host_decade: '1980s', difficulty: 'Very Hard', notes: 'After Take On Me — same falsetto register, same bright synth arpeggio world' },
];
